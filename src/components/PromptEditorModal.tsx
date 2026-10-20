import { skillApplicabilityHint, skillTaskForPrompt, SKILL_PURPOSE_LABELS } from "../clients/skillMetadataClient";
import { isGeneralSkill } from "../clients/creativeDirectionClient";
import { ManualAIResultField } from "./ManualAIResultField";
import { withManualAIResult } from "../../apps/web/src/clients/manualAIClient";
import { hasManualAIResult, type ManualAIResult } from "../../packages/domain/src/manualAI";
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Save, RotateCcw, Code, CheckSquare, Wand2, Layers, Eye, Send, FileText, ChevronDown, Scissors, AlertTriangle, Info, ShieldAlert, CheckCircle, Search, Sparkles, Images, ListVideo, ArrowUp, ArrowDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePromptStore } from '../clients/stateClient';
import { useProjectStore } from '../clients/stateClient';
import { useSkillStore, useSettingsStore } from '../clients/stateClient';
import {
  loadProductionPromptTemplate,
  productionTemplateMetadataRegistry,
  runManualPromptGatewayReview,
  validateProductionTemplateMetadata,
} from '../clients/productionPromptClient';
import toast from 'react-hot-toast';
import SkillRecommendationModal from './SkillRecommendationModal';
import {
  compileImageGenerationRequest,
  type ImageGenerationAspectRatio,
  type ImageGenerationReference,
  type ImageVisualStyleProjection,
} from '../clients/productionStudioWorkflowClient';
import type { VisualCompileManifest, VisualProjectionTargetSelection } from '../clients/domainTypes';

export interface ContextOption {
  id: string;
  label: string;
  value: string;
}

export interface PromptEditorImageReference extends ImageGenerationReference {
  id: string;
  sourceLabel?: string;
}

export interface VideoGenerationPromptDetail {
  modelPrompt: string;
  references: Array<{
    id: string;
    label: string;
    providerLabel?: string;
    name: string;
    relationship: string;
    mediaKind: "image" | "video" | "audio";
    thumbnailUrl?: string;
  }>;
  timeline: Array<{
    id: string;
    label: string;
    time: string;
    action: string;
    camera?: string;
    dialogue?: string;
    sound?: string;
  }>;
  issues: Array<{ severity: "blocking" | "warning"; message: string }>;
  requestSummary: string;
  nativeAudioExpected: boolean;
  visualStyleCompileManifest?: VisualCompileManifest;
}

export interface VideoGenerationPromptConfiguration {
  /** The owning surface already chose model and mode; confirmation may not override them. */
  selectionLocked?: boolean;
  modelOptions: Array<{
    id: string;
    label: string;
    generationWays: Array<{ id: string; label: string; audioModeOptions?: Array<{ id: "provider_native" | "reuse_dialogue" | "post_dub"; label: string }> }>;
    resolutionOptions: string[];
    sizeLabel?: string;
    audioModeOptions?: Array<{
      id: "provider_native" | "reuse_dialogue" | "post_dub";
      label: string;
    }>;
    defaultGenerationWayId?: string;
    defaultResolution?: string;
    defaultAudioMode?: "provider_native" | "reuse_dialogue" | "post_dub";
    supportsModelPromptOptimization?: boolean;
  }>;
  selectedModelConfigId: string;
  selectedGenerationWayId: string;
  selectedResolution?: string;
  selectedAudioMode: "provider_native" | "reuse_dialogue" | "post_dub";
  buildPreview: (input: {
    modelConfigId: string;
    generationWayId: string;
    resolution?: string;
    audioMode: "provider_native" | "reuse_dialogue" | "post_dub";
    creativePrompt: string;
    userIntent: string;
  }) => VideoGenerationPromptDetail;
  optimizeModelPrompt?: (input: {
    modelConfigId: string;
    generationWayId: string;
    resolution?: string;
    audioMode: "provider_native" | "reuse_dialogue" | "post_dub";
    creativePrompt: string;
    userIntent: string;
    currentModelPrompt: string;
    preview: VideoGenerationPromptDetail;
  }) => Promise<{ modelPrompt: string; warnings: string[]; modelLabel?: string }>;
}

export interface PromptEditorModalProps {
  presentation?: "modal" | "workspace";
  /** Stable target identity within the current project / episode / scene. */
  draftKey?: string;
  manualResultKind?: "text" | "image" | "video" | "audio";
  requireManualResult?: boolean;
  externalReferences?: { url: string; label: string }[];
  isOpen: boolean;
  onClose: () => void;
  /** Cancels a surrounding workflow; successful submission only closes the prompt. */
  onCancel?: () => void;
  templateId: string;
  variables: Record<string, string>;
  onConfirm: (finalPrompt: string, userIntent?: string, metadata?: PromptEditorConfirmMetadata) => void | Promise<void>;
  title?: string;
  contextOptions?: ContextOption[];
  defaultSelectedContextIds?: string[];
  imageReferences?: PromptEditorImageReference[];
  defaultSelectedImageReferenceIds?: string[];
  imageVisualStyleProjection?: ImageVisualStyleProjection;
  activeSceneId?: string;
  activeEpisodeId?: string;
  workflowStepId?: string;
  requiredRuntimeVariables?: string[];
  autoConfirm?: boolean;
  videoGeneration?: VideoGenerationPromptConfiguration;
}

export interface PromptEditorConfirmMetadata {
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedSkillSnapshots?: import("../clients/domainTypes").SkillDTO[];
  selectedContextIds: string[];
  selectedImageReferenceIds?: string[];
  templateId: string;
  workflowStepId?: string;
  videoGeneration?: {
    modelConfigId: string;
    generationWayId: string;
    resolution?: string;
    audioMode: "provider_native" | "reuse_dialogue" | "post_dub";
    finalModelPrompt: string;
    modelPromptSource: "adapter" | "llm" | "author_edited";
    promptAuthoringModelLabel?: string;
    visualStyleCompileManifest?: VisualCompileManifest;
  };
  visualStyleProjection?: {
    artifactIntent: string;
    recipeId: string;
    recipeVersion: string;
    sourceRevision?: string;
    sourceHash?: string;
    targetSelection?: VisualProjectionTargetSelection;
    compileManifest?: VisualCompileManifest;
  };
}

const EMPTY_ARRAY: string[] = [];
const CONTEXT_RISK_THRESHOLD = 12;
const imageReferenceRoleLabels: Record<ImageGenerationReference["role"], string> = {
  character_identity: "角色身份",
  wardrobe_state: "服装与造型状态",
  location_design: "场景空间与材质",
  prop_design: "道具几何与材质",
  vehicle_design: "交通工具结构与方位",
  composition_anchor: "构图与空间锚点",
  continuity_frame: "连续性承接画面",
  style_reference: "视觉风格参考",
  source_edit: "待编辑源图",
  previous_output_repair: "上一版待修复结果",
};
const modelReferenceLabels = (value: string) => Array.from(new Set(
  [...value.matchAll(/<(?:Subject|Picture|Video|Audio) \d+>/g)].map((match) => match[0]),
));

const workspaceDrafts = new Map<string, Record<string, any>>();
const workspacePending = new Set<string>();

export default function PromptEditorModal(props: PromptEditorModalProps) {
  const { currentProject, activeEpisode } = useProjectStore();
  const context = JSON.stringify([currentProject?.id, props.activeEpisodeId || activeEpisode?.id, props.activeSceneId]);
  const previousContext = useRef(context);
  const changedContext = previousContext.current !== context;
  useEffect(() => {
    if (props.presentation === "workspace" && changedContext && props.isOpen) props.onClose();
    previousContext.current = context;
  }, [context, changedContext, props.isOpen, props.onClose]);
  if (props.presentation === "workspace" && changedContext && props.isOpen) return null;
  const sessionKey = JSON.stringify([context, props.templateId, props.title, props.draftKey || JSON.stringify(props.variables)]);
  return props.presentation === 'workspace'
    ? props.isOpen ? <PromptEditorSession key={sessionKey} {...props} sessionKey={sessionKey} /> : null
    : <PromptEditorSession {...props} />;
}

function PromptEditorSession({
  isOpen,
  presentation = "modal",
  sessionKey,
  onClose,
  onCancel,
  templateId,
  variables,
  onConfirm,
  title = "AI 提示词编辑",
  contextOptions,
  defaultSelectedContextIds = EMPTY_ARRAY,
  imageReferences,
  defaultSelectedImageReferenceIds,
  imageVisualStyleProjection,
  activeSceneId,
  activeEpisodeId,
  workflowStepId,
  requiredRuntimeVariables = EMPTY_ARRAY,
  autoConfirm = false,
  videoGeneration,
  manualResultKind,
  requireManualResult = false,
  externalReferences,
}: PromptEditorModalProps & { sessionKey?: string }) {
  const isTestMode = useSettingsStore(state => state.isTestMode);
  const externalCopyOnly = requireManualResult && !isTestMode;
  const initialDraft = useRef(sessionKey ? workspaceDrafts.get(sessionKey) : undefined).current;
  const draftSnapshot = useRef<Record<string, any>>({});
  const submitted = useRef(false);
  const mounted = useRef(true);
  const submitLock = useRef(false);
  const generatedPrompt = useRef(initialDraft?.generatedPrompt || '');
  const { templates, updateTemplate, resetTemplate } = usePromptStore();
  const { currentProject, activeEpisode } = useProjectStore();
  const { skills, categories, fetchSkills } = useSkillStore();
  const templateObj = templates[templateId];
  
  const [activeTab, setActiveTab] = useState<'preview' | 'references' | 'modelPrompt' | 'template'>('preview');
  const [mobileConfigurationOpen, setMobileConfigurationOpen] = useState(false);
  const [manualResult, setManualResult] = useState<ManualAIResult>();
  const [resultUploading, setResultUploading] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  useEffect(() => { if (isOpen) { setManualResult(undefined); setResultUploading(false); setSubmissionError(''); setMobileConfigurationOpen(false); } }, [isOpen, templateId]);
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [currentTemplate, setCurrentTemplate] = useState('');
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>(defaultSelectedContextIds);
  const [selectedImageReferenceIds, setSelectedImageReferenceIds] = useState<string[]>(
    defaultSelectedImageReferenceIds || imageReferences?.map((reference) => reference.id) || EMPTY_ARRAY,
  );
  const orderedImageReferences = imageReferences
    ? [
        ...selectedImageReferenceIds
          .map((id) => imageReferences.find((reference) => reference.id === id))
          .filter((reference): reference is PromptEditorImageReference => Boolean(reference)),
        ...imageReferences.filter((reference) => !selectedImageReferenceIds.includes(reference.id)),
      ]
    : EMPTY_ARRAY;
  const isImageGenerationModal = imageReferences !== undefined;
  const selectedImageReferences = isImageGenerationModal
    ? selectedImageReferenceIds
        .map((id) => imageReferences.find((reference) => reference.id === id))
        .filter((reference): reference is PromptEditorImageReference => Boolean(reference))
    : [];
  const compiledImagePrompt = (() => {
    if (!isImageGenerationModal || !currentPrompt.trim()) {
      return { providerPrompt: currentPrompt, error: '' };
    }
    try {
      return {
        providerPrompt: compileImageGenerationRequest({
          promptCore: currentPrompt,
          aspectRatio: (currentProject?.aspectRatio || '16:9') as ImageGenerationAspectRatio,
          references: selectedImageReferences,
          visualStyleProjection: imageVisualStyleProjection,
        }).providerPrompt,
        error: '',
      };
    } catch (error) {
      return {
        providerPrompt: currentPrompt,
        error: error instanceof Error ? error.message : '最终图片提示词编译失败。',
      };
    }
  })();
  const [localContextOptions, setLocalContextOptions] = useState<ContextOption[]>(contextOptions || []);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [userIntent, setUserIntent] = useState('');
  const [versionCount, setVersionCount] = useState<number>(1);
  const [isSkillDropdownOpen, setIsSkillDropdownOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [skillPurposeFilter, setSkillPurposeFilter] = useState('all');
  const [skillCategoryFilter, setSkillCategoryFilter] = useState('all');
  const [isSkillRecommendationOpen, setIsSkillRecommendationOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(Boolean(sessionKey && workspacePending.has(sessionKey)));
  useEffect(() => {
    if (!sessionKey) return;
    const refresh = () => setIsSubmitting(workspacePending.has(sessionKey));
    window.addEventListener("omni:prompt-submission", refresh);
    return () => window.removeEventListener("omni:prompt-submission", refresh);
  }, [sessionKey]);
  const [isHandedOffToTask, setIsHandedOffToTask] = useState(false);
  const [autoConfirmStarted, setAutoConfirmStarted] = useState(false);
  const [videoModelConfigId, setVideoModelConfigId] = useState(videoGeneration?.selectedModelConfigId || '');
  const [videoGenerationWayId, setVideoGenerationWayId] = useState(videoGeneration?.selectedGenerationWayId || '');
  const [videoResolution, setVideoResolution] = useState(videoGeneration?.selectedResolution || '');
  const [videoAudioMode, setVideoAudioMode] = useState<"provider_native" | "reuse_dialogue" | "post_dub">(videoGeneration?.selectedAudioMode || "provider_native");
  const [videoPreview, setVideoPreview] = useState<VideoGenerationPromptDetail | null>(null);
  const [currentModelPrompt, setCurrentModelPrompt] = useState('');
  const [modelPromptEdited, setModelPromptEdited] = useState(false);
  const [modelPromptSource, setModelPromptSource] = useState<"adapter" | "llm" | "author_edited">("adapter");
  const [promptAuthoringModelLabel, setPromptAuthoringModelLabel] = useState<string>();
  const [isOptimizingModelPrompt, setIsOptimizingModelPrompt] = useState(false);
  const modelPromptBaselineRef = useRef('');
  const modelPromptRevisionRef = useRef(0);

  // Template metadata & diagnostics
  const metadata = productionTemplateMetadataRegistry[templateId];
  const metadataWarnings = validateProductionTemplateMetadata(metadata);
  
  const missingVars = Object.keys(variables).filter(v => !currentTemplate.includes(`{{${v}}}`));
  const hasSelectedContext = currentTemplate.includes('{{selectedContext}}');
  const hasSkills = currentTemplate.includes('{{skills}}');
  const hasUserIntent = currentTemplate.includes('{{userIntent}}');
  const requiresSelectedContext = metadata?.requiredVariables.includes('selectedContext') ?? hasSelectedContext;
  const requiresSkills = metadata?.requiredVariables.includes('skills') ?? hasSkills;
  const requiresUserIntent = metadata?.requiredVariables.includes('userIntent') ?? hasUserIntent;
  const generalSkills = skills.filter(isGeneralSkill);
  const selectedSkills = generalSkills.filter((skill) => selectedSkillIds.includes(skill.id));
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const normalizedSkillSearch = skillSearch.trim().toLowerCase();
  const visibleSkills = skills.filter((skill) => {
    const categoryName = skill.categoryId ? categoryNameById.get(skill.categoryId) : '';
    const categoryMatched = skillCategoryFilter === 'all'
      || (skillCategoryFilter === '__uncategorized' ? !skill.categoryId : skill.categoryId === skillCategoryFilter);
    const textMatched = !normalizedSkillSearch
      || [skill.title, skill.content, skill.categoryId, categoryName].some((value) => String(value || '').toLowerCase().includes(normalizedSkillSearch));
    return isGeneralSkill(skill) && categoryMatched && textMatched && (skillPurposeFilter === "all" || skill.purposes?.includes(skillPurposeFilter));
  });
  
  const templateConflicts: string[] = [];
  if (currentProject && metadata) {
    const combinedText = `${currentTemplate} ${metadata.qaRules?.join(' ') || ''}`;
    if (currentProject.type === 'movie' && /短剧|微短剧|打脸|爽点/i.test(combinedText)) {
      templateConflicts.push("模板包含短剧爽点元素，可能与电影长片的艺术因果与角色弧线冲突。");
    }
    if ((currentProject.type === 'short-drama' || currentProject.type === 'micro-short-drama') && /慢热|长镜头|生活流/i.test(combinedText)) {
      templateConflicts.push("模板包含慢热长镜头元素，可能与短剧快节奏高频反转冲突。");
    }
    if (currentProject.projectModel === 'interactive' && !/互动|选择|变量|分支/i.test(combinedText)) {
      templateConflicts.push("模板未声明互动选择/变量占位，可能退化为普通线性剧情。");
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    void fetchSkills();
  }, [fetchSkills, isOpen]);

  useEffect(() => {
    let active = true;
    if (isOpen) {
      if (initialDraft) {
        setCurrentTemplate(initialDraft.currentTemplate);
      } else loadProductionPromptTemplate(templateId, templateObj).then((loaded) => {
        if (active) setCurrentTemplate(loaded.template);
      });
      setSelectedContextIds(defaultSelectedContextIds);
      setSelectedImageReferenceIds(
        defaultSelectedImageReferenceIds || imageReferences?.map((reference) => reference.id) || [],
      );
      setLocalContextOptions(contextOptions || []);
      setSelectedSkillIds([]);
      setSkillSearch('');
      setSkillCategoryFilter('all');
      setSkillPurposeFilter('all');
      setUserIntent('');
      setVersionCount(1);
      setActiveTab(imageReferences !== undefined ? 'modelPrompt' : 'preview');
      setIsHandedOffToTask(false);
      setAutoConfirmStarted(false);
      setVideoModelConfigId(videoGeneration?.selectedModelConfigId || '');
      setVideoGenerationWayId(videoGeneration?.selectedGenerationWayId || '');
      setVideoResolution(videoGeneration?.selectedResolution || '');
      setVideoAudioMode(videoGeneration?.selectedAudioMode || 'provider_native');
      setVideoPreview(null);
      setCurrentModelPrompt('');
      setModelPromptEdited(false);
      setModelPromptSource('adapter');
      setPromptAuthoringModelLabel(undefined);
      setIsOptimizingModelPrompt(false);
      modelPromptBaselineRef.current = '';
      modelPromptRevisionRef.current += 1;
    }
    return () => {
      active = false;
    };
      // Configuration objects may be recreated by the canvas on every render.
      // A workspace session is keyed by its explicit task and source context.
  }, [isOpen, templateId]);

  useEffect(() => {
    if (initialDraft) {
      modelPromptBaselineRef.current = initialDraft.modelPromptBaseline || "";
      setCurrentPrompt(initialDraft.currentPrompt);
      setCurrentTemplate(initialDraft.currentTemplate);
      setSelectedContextIds(initialDraft.selectedContextIds);
      setSelectedImageReferenceIds(initialDraft.selectedImageReferenceIds);
      setLocalContextOptions(initialDraft.localContextOptions);
      setSelectedSkillIds(initialDraft.selectedSkillIds);
      setUserIntent(initialDraft.userIntent);
      setVersionCount(initialDraft.versionCount);
      setActiveTab(initialDraft.activeTab);
      setManualResult(initialDraft.manualResult);
      setVideoModelConfigId(initialDraft.videoModelConfigId);
      setVideoGenerationWayId(initialDraft.videoGenerationWayId);
      setVideoResolution(initialDraft.videoResolution);
      setVideoAudioMode(initialDraft.videoAudioMode);
      setCurrentModelPrompt(initialDraft.currentModelPrompt);
      setModelPromptEdited(initialDraft.modelPromptEdited);
      setModelPromptSource(initialDraft.modelPromptSource);
      setPromptAuthoringModelLabel(initialDraft.promptAuthoringModelLabel);
    }
  }, []);

  draftSnapshot.current = { currentPrompt, currentTemplate, selectedContextIds, selectedImageReferenceIds, localContextOptions, selectedSkillIds, userIntent, versionCount, activeTab, manualResult, videoModelConfigId, videoGenerationWayId, videoResolution, videoAudioMode, currentModelPrompt, modelPromptEdited, modelPromptSource, promptAuthoringModelLabel, generatedPrompt: generatedPrompt.current, modelPromptBaseline: modelPromptBaselineRef.current };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (sessionKey && !submitted.current) {
        workspaceDrafts.set(sessionKey, draftSnapshot.current);
        if (workspaceDrafts.size > 40) workspaceDrafts.delete(workspaceDrafts.keys().next().value!);
      }
    };
  }, [sessionKey]);
  useEffect(() => {
    if (!isOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSkillRecommendationOpen) { event.preventDefault(); (onCancel || onClose)(); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [isOpen, onClose, onCancel, isSkillRecommendationOpen]);

  useEffect(() => {
    if (!isOpen || !currentTemplate) return;
    const next = replaceVariables(currentTemplate, variables, selectedContextIds, selectedSkillIds, userIntent, versionCount);
    if (next !== generatedPrompt.current) {
      generatedPrompt.current = next;
      setCurrentPrompt(next);
    }
  }, [currentTemplate, variables, selectedContextIds, selectedSkillIds, userIntent, versionCount, isOpen, localContextOptions, skills]);

  const selectedVideoModelOption = videoGeneration?.modelOptions.find((option) => option.id === videoModelConfigId);
  const selectedVideoAudioOptions = selectedVideoModelOption?.generationWays.find(option => option.id === videoGenerationWayId)?.audioModeOptions
    || selectedVideoModelOption?.audioModeOptions
    || [{ id: 'post_dub' as const, label: '后期另行配音' }];
  const effectiveVideoAudioMode = selectedVideoAudioOptions.some(option => option.id === videoAudioMode)
    ? videoAudioMode : selectedVideoAudioOptions[0]?.id || 'post_dub';
  const recompileEditedModelPrompt = () => {
    if (modelPromptEdited) {
      toast('模型专用提示词将按新选择重新整理；通用创作提示词保持不变。');
    }
    setModelPromptEdited(false);
    setModelPromptSource('adapter');
    setPromptAuthoringModelLabel(undefined);
    modelPromptRevisionRef.current += 1;
  };

  useEffect(() => {
    if (!isOpen || !currentTemplate || !videoGeneration || !videoModelConfigId || !videoGenerationWayId) return;
    let next: VideoGenerationPromptDetail;
    try {
      next = videoGeneration.buildPreview({
        modelConfigId: videoModelConfigId,
        generationWayId: videoGenerationWayId,
        resolution: videoResolution || undefined,
        audioMode: effectiveVideoAudioMode,
        creativePrompt: currentPrompt,
        userIntent,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频请求预览编译失败。';
      setVideoPreview({
        modelPrompt: '',
        references: [],
        timeline: [],
        issues: [{ severity: 'blocking', message }],
        requestSummary: '视频请求尚未就绪',
        nativeAudioExpected: false,
      });
      setCurrentModelPrompt('');
      setModelPromptEdited(false);
      setModelPromptSource('adapter');
      setPromptAuthoringModelLabel(undefined);
      return;
    }
    setVideoPreview(next);
    if (modelPromptBaselineRef.current !== next.modelPrompt) {
      modelPromptBaselineRef.current = next.modelPrompt;
      modelPromptRevisionRef.current += 1;
      setCurrentModelPrompt(next.modelPrompt);
      setModelPromptEdited(false);
      setModelPromptSource('adapter');
      setPromptAuthoringModelLabel(undefined);
    } else if (!modelPromptEdited) {
      setCurrentModelPrompt(next.modelPrompt);
    }
  }, [currentTemplate, currentPrompt, isOpen, modelPromptEdited, userIntent, effectiveVideoAudioMode, videoGeneration, videoGenerationWayId, videoModelConfigId, videoResolution]);

  const handleOptimizeModelPrompt = async () => {
    if (!videoGeneration?.optimizeModelPrompt || !videoPreview || isOptimizingModelPrompt) return;
    const requestedRevision = modelPromptRevisionRef.current;
    setIsOptimizingModelPrompt(true);
    try {
      const result = await videoGeneration.optimizeModelPrompt({
        modelConfigId: videoModelConfigId,
        generationWayId: videoGenerationWayId,
        resolution: videoResolution || undefined,
        audioMode: effectiveVideoAudioMode,
        creativePrompt: currentPrompt,
        userIntent,
        currentModelPrompt,
        preview: videoPreview,
      });
      if (requestedRevision !== modelPromptRevisionRef.current) {
        toast('生成资料已变化，本次大模型整理结果未采用。');
        return;
      }
      setCurrentModelPrompt(result.modelPrompt);
      setModelPromptEdited(true);
      setModelPromptSource('llm');
      setPromptAuthoringModelLabel(result.modelLabel);
      if (result.warnings.length > 0) toast(result.warnings[0]);
      else toast.success('模型提示词已由大模型整理，并通过 H3 规则检查。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '大模型整理失败，已保留规则生成的提示词。');
    } finally {
      setIsOptimizingModelPrompt(false);
    }
  };

  const handlePruneContext = () => {
    if (!activeEpisode || !activeSceneId || !currentProject) {
      toast.error('缺少足够的信息（当前无激活的场景），无法进行上下文剪裁。');
      return;
    }

    const scenes = activeEpisode.scenes || [];
    const currentIndex = scenes.findIndex((s: any) => s.id === activeSceneId);
    if (currentIndex === -1) {
      toast.error('找不到当前场景，裁剪失败。');
      return;
    }

    // Identify relevant scenes (Current, and 2 before, 2 after)
    const validScenes = scenes.slice(Math.max(0, currentIndex - 2), Math.min(scenes.length, currentIndex + 3));

    const relevantCharIds = new Set<string>();
    const relevantAssetIds = new Set<string>();

    validScenes.forEach((scene: any) => {
      if (scene.breakdown) {
        scene.breakdown.characterIds?.forEach((id: string) => relevantCharIds.add(id));
        scene.breakdown.propIds?.forEach((id: string) => relevantAssetIds.add(id));
        if (scene.breakdown.locationId) {
          relevantAssetIds.add(scene.breakdown.locationId);
        }
      }
      if (scene.scriptBlocks) {
        scene.scriptBlocks.forEach((block: any) => {
          if (block.linkedAssetId) {
            // Can be character or prop/location. We add to both sets just to be safe.
            relevantCharIds.add(block.linkedAssetId);
            relevantAssetIds.add(block.linkedAssetId);
          }
          if (block.locationId) relevantAssetIds.add(block.locationId);
          block.propIds?.forEach((id: string) => relevantAssetIds.add(id));
        });
      }
    });

    // We also need to filter the "relationships" context Option string
    const newContextOptions = (contextOptions || []).map(opt => {
      if (opt.id === 'ctx_relationships') {
        const filteredRelationships = currentProject.relationships?.filter((r: any) => {
          return relevantCharIds.has(r.sourceId) && relevantCharIds.has(r.targetId);
        }) || [];
        
        if (filteredRelationships.length === 0) {
           return { ...opt, value: '' };
        }

        const relsStr = filteredRelationships.map((r: any) => {
          const sourceChar = currentProject.characters?.find((c: any) => c.id === r.sourceId);
          const targetChar = currentProject.characters?.find((c: any) => c.id === r.targetId);
          const dynamicsStr = r.dynamics && Object.keys(r.dynamics).length > 0 ? ` [动态维度: ${JSON.stringify(r.dynamics)}]` : '';
          if (!sourceChar?.name || !targetChar?.name) return '';
          return `- ${sourceChar.name} -> ${targetChar.name}: [${r.type}] ${r.description}${dynamicsStr}`;
        }).filter(Boolean).join('\n');
        
        return {
          ...opt,
          value: `<relationships>\n${relsStr}\n</relationships>`
        };
      }
      return opt;
    });

    setLocalContextOptions(newContextOptions);

    // Calculate new selected ids
    const newSelectedIds = selectedContextIds.filter(id => {
       if (id.startsWith('ctx_char_')) {
          const charId = id.replace('ctx_char_', '');
          return relevantCharIds.has(charId);
       }
       if (id.startsWith('ctx_asset_')) {
          const assetId = id.replace('ctx_asset_', '');
          return relevantAssetIds.has(assetId) || relevantCharIds.has(assetId);
       }
       return true;
    });

    setSelectedContextIds(newSelectedIds);
    toast.success('AI上下文截断风险已解除！\n已裁剪未出场角色及资产。');
  };

  const replaceVariables = (tpl: string, vars: Record<string, string>, selectedIds: string[], skillIds: string[], intent: string, count: number) => {
    let content = tpl;
    
    for (const [key, value] of Object.entries(vars)) {
      content = content.replace(new RegExp(`{{${key}}}`, 'g'), () => value || '');
    }
    
    let selectedContextText = '';
    if (localContextOptions) {
      selectedContextText = localContextOptions
        .filter(opt => selectedIds.includes(opt.id) && opt.id !== 'ctx_activeSkills')
        .map(opt => opt.value)
        .join('\n\n');
    }

    const selectedSkills = skills.filter(s => isGeneralSkill(s) && skillIds.includes(s.id));
    let finalSkillsText = '';
    
    if (selectedSkills.length > 0) {
      const skillsText = selectedSkills.map((skill, index) => {
        const title = skill.title || `Skill ${index + 1}`;
        const contentText = (skill.content || '').trim();
        return `【Skill：${title}】\n${contentText}`;
      }).join('\n\n');
      
      finalSkillsText = [
        '【作者选择的通用 Skill】',
        '以下内容由作者在提示词弹窗中手动选择。请重点参考这些写作方法、规律或注意事项；若与本次任务目标冲突，以本次任务目标、已确定事实和输出格式为准，不要机械照抄。',
        '',
        skillsText,
        '【通用 Skill 结束】',
      ].join('\n');
      
      if (content.includes('{{skills}}')) {
        content = content.replace(/{{skills}}/g, () => finalSkillsText);
      }
    } else {
      content = content.replace(/{{skills}}/g, '');
    }
    
    if (content.includes('{{selectedContext}}')) {
      content = content.replace(/{{selectedContext}}/g, () => selectedContextText);
    }

    
    content = content.replace(
      /{{userIntent}}/g,
      () => intent.trim(),
    );
    
    content = content.replace(/{{versionCount}}/g, count.toString());
    
    let previousContent;
    do {
      previousContent = content;
      content = content.replace(/【[^】]+】[:：]?\n\s*(?=【|$)/g, '');
    } while (content !== previousContent);
    
    if (vars.creativeDirection?.trim() && !content.includes(vars.creativeDirection.trim())) content += "\n\n" + vars.creativeDirection.trim();
    return content.trim();
  };

  const handleTemplateChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentTemplate(e.target.value);
  };

  const toggleContextOption = (id: string) => {
    setSelectedContextIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleImageReference = (id: string) => {
    setSelectedImageReferenceIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  };

  const moveImageReference = (id: string, direction: -1 | 1) => {
    setSelectedImageReferenceIds((previous) => {
      const currentIndex = previous.indexOf(id);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= previous.length) return previous;
      const reordered = [...previous];
      [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
      return reordered;
    });
  };

  const toggleSkillOption = (id: string) => {
    setSelectedSkillIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSaveTemplate = () => {
    updateTemplate(templateId, currentTemplate);
    toast.success('模板已保存');
  };

  const handleResetTemplate = () => {
    resetTemplate(templateId);
    const defaultTpl = usePromptStore.getState().templates[templateId].template;
    setCurrentTemplate(defaultTpl);
    toast.success('已恢复默认模板');
  };

  const handleGenerateContent = async () => {
    if (externalCopyOnly || submitLock.current || isSubmitting || resultUploading || (sessionKey && workspacePending.has(sessionKey))) return;
    if (requireManualResult && !hasManualAIResult(manualResult)) { toast.error("请先上传外部生成结果，再确认采用。"); return; }
    const missingRuntimeVariables = requiredRuntimeVariables.filter((key) => !currentPrompt.includes(`{{${key}}}`));
    if (missingRuntimeVariables.length > 0) {
      toast.error(`批量任务提示词缺少运行时变量：${missingRuntimeVariables.map((key) => `{{${key}}}`).join('、')}`);
      return;
    }
    const blockingVideoIssue = videoPreview?.issues.find((issue) => issue.severity === 'blocking');
    if (blockingVideoIssue) {
      toast.error(blockingVideoIssue.message);
      return;
    }
    if (videoPreview) {
      if (!currentModelPrompt.trim()) {
        toast.error('模型提示词不能为空。');
        return;
      }
      const compiledLabels = modelReferenceLabels(videoPreview.modelPrompt);
      const editedLabels = modelReferenceLabels(currentModelPrompt);
      const missingLabels = compiledLabels.filter((label) => !editedLabels.includes(label));
      const unknownLabels = editedLabels.filter((label) => !compiledLabels.includes(label));
      if (missingLabels.length > 0 || unknownLabels.length > 0) {
        toast.error('模型提示词中的人物和素材标签已与引用素材不一致，请恢复标签后再生成。');
        return;
      }
    }
    submitLock.current = true;
    if (sessionKey) workspacePending.add(sessionKey);
    setIsSubmitting(true);
    setSubmissionError('');
    if (presentation === "modal") setIsHandedOffToTask(true);
    const effectiveSelectedContextIds = hasSelectedContext ? selectedContextIds : [];
    const effectiveSelectedSkillIds = hasSkills ? selectedSkills.map(skill => skill.id) : [];
    try {
      const gateway = await runManualPromptGatewayReview({
        projectId: currentProject?.id,
        episodeId: activeEpisodeId || activeEpisode?.id,
        sceneId: activeSceneId,
        templateId,
        workflowStepId,
        stageType: metadata?.stageType,
        finalPrompt: currentPrompt,
        currentTemplate,
        variables,
        userIntent,
        selectedContextIds: effectiveSelectedContextIds,
        selectedSkillIds: effectiveSelectedSkillIds,
        selectedSkillSnapshots: hasSkills ? structuredClone(selectedSkills) : [],
        missingVariables: missingVars,
        templateConflicts,
      });
      if (!mounted.current) return;
      const hasBlockingIssue = gateway.qaVerdicts.some((verdict) => verdict.blocking);
      if (hasBlockingIssue) {
        setIsHandedOffToTask(false);
        toast.error('提示词检查未通过，请先修复阻断问题。');
        return;
      }
      try {
        await withManualAIResult(currentPrompt, manualResult, () => onConfirm(currentPrompt, userIntent, {
          selectedSkillIds: effectiveSelectedSkillIds,
          selectedSkillSnapshots: hasSkills ? structuredClone(selectedSkills) : [],
          selectedSkillTitles: hasSkills ? selectedSkills.map((skill) => skill.title || '未命名 Skill') : [],
          selectedContextIds: effectiveSelectedContextIds,
          selectedImageReferenceIds,
          templateId,
          workflowStepId,
          ...(videoGeneration ? {
            videoGeneration: {
              modelConfigId: videoModelConfigId,
              generationWayId: videoGenerationWayId,
              resolution: videoResolution || undefined,
              audioMode: effectiveVideoAudioMode,
              finalModelPrompt: currentModelPrompt,
              modelPromptSource,
              promptAuthoringModelLabel,
              visualStyleCompileManifest: videoPreview?.visualStyleCompileManifest,
            },
          } : {}),
          ...(imageVisualStyleProjection ? {
            visualStyleProjection: {
              artifactIntent: imageVisualStyleProjection.artifactIntent,
              recipeId: imageVisualStyleProjection.recipeId,
              recipeVersion: imageVisualStyleProjection.recipeVersion,
              sourceRevision: imageVisualStyleProjection.sourceRevision,
              sourceHash: imageVisualStyleProjection.sourceHash,
              targetSelection: imageVisualStyleProjection.targetSelection,
              compileManifest: imageVisualStyleProjection.compileManifest,
            },
          } : {}),
        }));
        if (sessionKey) workspaceDrafts.delete(sessionKey);
        submitted.current = true;
        if (mounted.current) onClose();
      } catch (error) {
        setIsHandedOffToTask(false);
        console.error('Prompt task execution failed:', error);
        setSubmissionError(error instanceof Error ? error.message : '任务执行失败');
        if (presentation === 'modal') toast.error(error instanceof Error ? error.message : '任务执行失败');
      }
    } catch (error) {
      setIsHandedOffToTask(false);
      console.error('Manual prompt gateway review failed:', error);
      toast.error(error instanceof Error ? error.message : '提示词检查失败');
    } finally {
      submitLock.current = false;
      if (sessionKey) { workspacePending.delete(sessionKey); window.dispatchEvent(new Event("omni:prompt-submission")); }
      setIsSubmitting(false);
    }
  };

  // Every AI entry stays visible so authors can copy prompts and supply external results.
  // The legacy autoConfirm prop is retained only for compatibility with existing callers.

  if (!templateObj) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && !isHandedOffToTask && (
        <motion.div
          key="prompt-editor-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role={presentation === 'workspace' ? 'region' : 'dialog'}
          aria-label={title}
          aria-modal={presentation === 'modal' ? true : undefined}
          className={presentation === 'workspace' ? 'prompt-workspace z-[90]' : 'fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-6 bg-black/50 backdrop-blur-sm'}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            className="prompt-editor-surface bg-white dark:bg-neutral-950 rounded-2xl shadow-2xl border border-gray-200 dark:border-neutral-800 w-full max-w-6xl flex flex-col h-[92vh] sm:h-[85vh] overflow-hidden"
          >
             {/* Header - Slimmed down & efficient */}
             <div className="prompt-editor-header shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 dark:border-neutral-900 bg-white dark:bg-neutral-950 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="w-8 h-8 shrink-0 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 flex items-center justify-center">
                    <Wand2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-bold leading-5 text-gray-900 dark:text-white">
                      {title}
                    </h2>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  {presentation === 'workspace' && <span className="whitespace-nowrap text-xs text-text-muted">关闭保留草稿</span>}
                  {/* Status Indicator */}
                  <div className="prompt-editor-ready hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/10 rounded-full border border-emerald-100 dark:border-emerald-900/20">
                     <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                     <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">AI 就绪</span>
                  </div>
                  <button onClick={onCancel || onClose} aria-label="关闭提示词窗口" className="p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
             </div>

             {/* Content Layout - Maximize Text Area Space */}
             <div className="prompt-editor-content flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
               {/* Left Sidebar - Configuration */}
               <div className="prompt-editor-configuration flex max-h-[42%] w-full shrink-0 flex-col border-b border-gray-100 bg-gray-50/50 dark:border-neutral-900 dark:bg-neutral-950/50 lg:max-h-none lg:w-[300px] lg:border-b-0 lg:border-r">
                  <button
                    type="button"
                    aria-expanded={mobileConfigurationOpen}
                    onClick={() => setMobileConfigurationOpen(open => !open)}
                    className="prompt-editor-configuration-toggle flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-xs font-medium text-gray-600 dark:text-neutral-300 lg:hidden"
                  >
                    <span>{videoGeneration || imageReferences?.length ? '生成设置与参考资料' : '补充要求与参考资料'}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${mobileConfigurationOpen ? 'rotate-180' : ''}`} />
                  </button>
                  <div className={`prompt-editor-configuration-fields ${mobileConfigurationOpen ? 'block' : 'hidden'} min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-5 sm:space-y-6 lg:block`}>

                    {videoGeneration && selectedVideoModelOption && (
                      <div className="space-y-3 border-b border-gray-200 pb-5 dark:border-neutral-800">
                        <label className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-neutral-400">
                          <ListVideo className="h-3.5 w-3.5" />
                          本次视频生成
                        </label>
                        <label className="block text-[10px] font-bold text-gray-500">目标模型
                          <select
                            value={videoModelConfigId}
                            disabled={videoGeneration.selectionLocked}
                            onChange={(event) => {
                              const option = videoGeneration.modelOptions.find((item) => item.id === event.target.value);
                              setVideoModelConfigId(event.target.value);
                              setVideoGenerationWayId(option?.defaultGenerationWayId || option?.generationWays[0]?.id || '');
                              setVideoResolution(option?.defaultResolution || option?.resolutionOptions[0] || '');
                              setVideoAudioMode(option?.defaultAudioMode || 'provider_native');
                              recompileEditedModelPrompt();
                            }}
                            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                          >
                            {videoGeneration.modelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </label>
                        <label className="block text-[10px] font-bold text-gray-500">生成方式
                          <select
                            value={videoGenerationWayId}
                            disabled={videoGeneration.selectionLocked}
                            onChange={(event) => {
                              setVideoGenerationWayId(event.target.value);
                              recompileEditedModelPrompt();
                            }}
                            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                          >
                            {selectedVideoModelOption.generationWays.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </label>
                        {selectedVideoModelOption.resolutionOptions.length > 0 && (
                          <label className="block text-[10px] font-bold text-gray-500">清晰度
                            <select
                              value={videoResolution}
                              onChange={(event) => {
                                setVideoResolution(event.target.value);
                                recompileEditedModelPrompt();
                              }}
                              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:border-violet-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                            >
                              {selectedVideoModelOption.resolutionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          </label>
                        )}
                        {selectedVideoModelOption.sizeLabel && (
                          <p className="text-[10px] font-bold text-gray-500">{selectedVideoModelOption.sizeLabel}</p>
                        )}
                        <label className="block text-[10px] font-bold text-gray-500">人物声音
                          <select
                            value={effectiveVideoAudioMode}
                            onChange={(event) => {
                              setVideoAudioMode(event.target.value as typeof videoAudioMode);
                              recompileEditedModelPrompt();
                            }}
                            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:border-violet-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                          >
                            {selectedVideoAudioOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </label>
                        {!selectedVideoAudioOptions.some(option => option.id === 'reuse_dialogue') && <p className="text-[10px] leading-4 text-gray-500">当前生成方式不会向视频接口提交角色音色或台词音频。已有录音保留在声音资产中，可在视频生成后替换声音或在时间线混音；不会自动合成。</p>}
                        {videoPreview && <p className="text-[10px] leading-4 text-gray-500">{videoPreview.requestSummary}</p>}
                        {videoPreview?.issues.map((issue, index) => (
                          <p key={`${issue.severity}-${index}`} className={`flex gap-1.5 text-[10px] leading-4 ${issue.severity === 'blocking' ? 'text-rose-600' : 'text-amber-600'}`}>
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{issue.message}
                          </p>
                        ))}
                      </div>
                    )}
                    
                    {/* User Intent / Prompt Extension */}
                    {templateObj.template.includes('{{userIntent}}') && (
                      <div className="space-y-2.5">
                        <label className="text-[11px] font-black text-gray-500 dark:text-neutral-400 uppercase tracking-widest flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" />
                          意图指令 (Intent)
                        </label>
                        <textarea
                          value={userIntent}
                          onChange={(e) => setUserIntent(e.target.value)}
                          className="w-full bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl p-3 text-[13px] text-gray-800 dark:text-neutral-200 resize-none outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10 transition-all custom-scrollbar min-h-[96px] sm:min-h-[140px] shadow-sm leading-relaxed"
                          placeholder="补充额外的定向要求或创意偏好..."
                        />
                      </div>
                    )}

                    {/* Context / Mode Selectors */}
                    {imageReferences !== undefined && (
                      <div className="space-y-2.5 border-t border-gray-200 pt-4 dark:border-neutral-800">
                        <div>
                          <label className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-gray-500 dark:text-neutral-400">
                            <Images className="h-3.5 w-3.5" />
                            本次参考图 ({selectedImageReferenceIds.length}/{imageReferences.length})
                          </label>
                          <p className="mt-1 text-[10px] leading-4 text-gray-500">
                            选中的图片会实际发送给图像模型。
                          </p>
                        </div>
                        {imageReferences.length > 0 ? (
                          <div className="flex flex-col gap-2">
                            {orderedImageReferences.map((reference) => {
                              const isSelected = selectedImageReferenceIds.includes(reference.id);
                              const selectedIndex = selectedImageReferenceIds.indexOf(reference.id);
                              return (
                                <div
                                  key={reference.id}
                                  className={`flex items-center gap-2 rounded-xl border p-2 transition-colors ${
                                    isSelected
                                      ? 'border-cyan-500/45 bg-cyan-500/10 text-text-primary'
                                      : 'border-transparent bg-bg-surface-soft text-text-secondary hover:bg-bg-surface-hover'
                                  }`}
                                >
                                  <button type="button" onClick={() => toggleImageReference(reference.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                                    <span className="relative flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/20">
                                      <img
                                        src={reference.imageUrl}
                                        alt={reference.label}
                                        className="h-full w-full object-contain"
                                        referrerPolicy="no-referrer"
                                      />
                                      <span className={`absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded border ${
                                        isSelected
                                          ? 'border-cyan-400 bg-cyan-500 text-black'
                                          : 'border-white/50 bg-black/45 text-transparent'
                                      }`}>
                                        <CheckSquare className="h-3 w-3" />
                                      </span>
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[11px] font-bold">{isSelected ? `参考图 ${selectedIndex + 1} · ` : ''}{reference.label}</span>
                                      <span className="mt-0.5 block truncate text-[9px] font-bold text-cyan-700 dark:text-cyan-300">{imageReferenceRoleLabels[reference.role]}</span>
                                      <span className="mt-1 block line-clamp-2 text-[9px] leading-4 text-text-muted" title={reference.preserve.join("；")}>保留：{reference.preserve.join("；")}</span>
                                      <span className="block line-clamp-2 text-[9px] leading-4 text-text-muted" title={reference.allowChange.join("；")}>可改：{reference.allowChange.join("；")}</span>
                                      <span className="block line-clamp-2 text-[9px] leading-4 text-text-muted" title={reference.exclude.join("；")}>排除：{reference.exclude.join("；")}</span>
                                      {reference.sourceLabel && (
                                        <span className="mt-1 block truncate text-[9px] text-text-muted">{reference.sourceLabel}</span>
                                      )}
                                    </span>
                                  </button>
                                  {isSelected && (
                                    <div className="flex shrink-0 flex-col gap-1">
                                      <button type="button" title="上移参考图" aria-label="上移参考图" disabled={selectedIndex === 0} onClick={() => moveImageReference(reference.id, -1)} className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-bg-surface-hover disabled:opacity-30">
                                        <ArrowUp className="h-3.5 w-3.5" />
                                      </button>
                                      <button type="button" title="下移参考图" aria-label="下移参考图" disabled={selectedIndex === selectedImageReferenceIds.length - 1} onClick={() => moveImageReference(reference.id, 1)} className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-bg-surface-hover disabled:opacity-30">
                                        <ArrowDown className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="rounded-xl border border-dashed border-gray-200 p-3 text-[10px] leading-4 text-gray-500 dark:border-neutral-800">
                            本镜头没有可用的正式参考图，将按文生图执行。
                          </p>
                        )}
                      </div>
                    )}

                    {hasSelectedContext && localContextOptions && localContextOptions.length > 0 && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-black text-gray-500 dark:text-neutral-400 uppercase tracking-widest flex items-center gap-1.5">
                             <Layers className="w-3.5 h-3.5"/> 
                             文本上下文 ({selectedContextIds.length}/{localContextOptions.length})
                          </label>
                          {localContextOptions.length > CONTEXT_RISK_THRESHOLD && activeSceneId && (
                             <button onClick={handlePruneContext} title="移除与当前场次无关的角色和资产资料" className="flex items-center gap-1 text-[10px] bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 px-2 py-0.5 rounded font-bold transition-colors">
                               <Scissors className="w-3 h-3" />
                               极简裁剪
                             </button>
                          )}
                        </div>
                        {selectedContextIds.length > CONTEXT_RISK_THRESHOLD && (
                           <div className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1.5 rounded flex items-start gap-1 leading-snug">
                             <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                             <span>选中资料过多，AI 可能遗漏中间内容。建议只保留与当前任务直接相关的资料。</span>
                           </div>
                        )}
                        <div className="flex flex-col gap-2">
                          {localContextOptions.map(opt => {
                            const isSelected = selectedContextIds.includes(opt.id);
                            return (
                              <button
                                key={opt.id}
                                onClick={() => toggleContextOption(opt.id)}
                                className={`flex items-start gap-3 p-3 rounded-xl border border-transparent text-left transition-colors ${
                                  isSelected
                                    ? 'bg-bg-surface-hover text-text-primary'
                                    : 'bg-bg-surface-soft text-text-secondary hover:bg-bg-surface-hover'
                                }`}
                              >
                                <div className={`shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-text-primary border-text-primary text-bg-primary' : 'border-border-primary/50'}`}>
                                   {isSelected && <CheckSquare className="w-3 h-3" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[12px] font-bold truncate leading-tight mb-1">{opt.label}</div>
                                  <div className={`text-[10px] line-clamp-2 leading-relaxed ${isSelected ? 'text-text-primary/70' : 'text-text-muted'}`}>
                                    {opt.value}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Skills Selectors */}
                    {hasSkills && <div className="space-y-2.5 pt-4 border-t border-gray-200 dark:border-neutral-800 relative z-10">
                      <label className="text-[11px] font-black text-gray-500 dark:text-neutral-400 uppercase tracking-widest flex items-center gap-1.5">
                         <Wand2 className="w-3.5 h-3.5"/>
                         通用 Skill（可选） ({selectedSkills.length}/{generalSkills.length})
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsSkillRecommendationOpen(true)}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-bg-surface-soft px-3 py-2 text-[12px] font-black text-text-primary transition hover:bg-bg-surface-hover active:scale-95 shadow-sm"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        AI 推荐 Skill
                      </button>
                      {selectedSkills.length > 0 && (
                        <div className="rounded-xl border border-transparent bg-bg-surface-soft p-2 text-[11px] font-bold leading-5 text-text-secondary">
                          已选：{selectedSkills.map((skill) => `${skill.title || '未命名 Skill'}（${skillApplicabilityHint(skill, { task: skillTaskForPrompt(templateId, metadata?.stageType), projectFormat: currentProject?.type })}）`).join('、')}
                        </div>
                      )}
                      <button
                        onClick={() => setIsSkillDropdownOpen(!isSkillDropdownOpen)}
                        className="w-full flex items-center justify-between p-3 rounded-xl border border-transparent bg-bg-surface-soft text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-colors outline-none"
                      >
                        <span className="text-[12px] font-bold">
                          {generalSkills.length === 0 ? '暂无通用 Skill，可直接继续' : selectedSkills.length > 0 ? `已选择 ${selectedSkills.length} 个 Skill` : '点击选择通用 Skill...'}
                        </span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${isSkillDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      <AnimatePresence>
                        {isSkillDropdownOpen && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-2 max-h-[280px] overflow-y-auto bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl shadow-sm flex flex-col p-2 space-y-2">
                              <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                                <input
                                  value={skillSearch}
                                  onChange={(event) => setSkillSearch(event.target.value)}
                                  placeholder="搜索 Skill 标题或内容..."
                                  className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-[12px] font-bold text-gray-800 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-500/10 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
                                />
                              </div>
                              <select
                                value={skillCategoryFilter}
                                onChange={(event) => setSkillCategoryFilter(event.target.value)}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-bold text-gray-700 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-500/10 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
                              >
                                <option value="all">全部分类</option>
                                <option value="__uncategorized">未分类</option>
                                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                              </select>
                              <select aria-label="筛选 Skill 用途" value={skillPurposeFilter} onChange={event => setSkillPurposeFilter(event.target.value)} className="w-full rounded-lg border border-border-soft bg-bg-surface px-3 py-2 text-xs"><option value="all">全部用途</option>{[...new Set(generalSkills.flatMap(skill => skill.purposes || []))].map(value => <option key={value} value={value}>{SKILL_PURPOSE_LABELS[value] || value}</option>)}</select>
                              {generalSkills.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-gray-200 p-3 text-[11px] font-bold leading-5 text-gray-400 dark:border-neutral-800">
                                  暂无通用 Skill。
                                  <Link to="/skills" className="ml-1 text-emerald-600 underline-offset-2 hover:underline dark:text-emerald-300">打开 Skill 库创建</Link>
                                </div>
                              ) : visibleSkills.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-gray-200 p-3 text-[11px] font-bold leading-5 text-gray-400 dark:border-neutral-800">
                                  没有匹配的 Skill。
                                </div>
                              ) : (
                                <div className="flex flex-col space-y-1">
                                  {visibleSkills.map(skill => {
                                    const isSelected = selectedSkillIds.includes(skill.id);
                                    return (
                                      <button
                                        key={skill.id}
                                        onClick={() => toggleSkillOption(skill.id)}
                                        className={`flex items-start gap-3 p-2.5 rounded-lg text-left transition-colors ${
                                          isSelected
                                            ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                                            : 'hover:bg-gray-50 dark:hover:bg-neutral-800 text-gray-700 dark:text-neutral-300'
                                        }`}
                                      >
                                        <div className={`shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-neutral-700'}`}>
                                           {isSelected && <CheckSquare className="w-3 h-3" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-[11px] font-bold truncate leading-tight">{skill.title}</div>
                                          <div className="mt-1 text-[10px] leading-4 text-text-muted">{skill.purposes?.map(value => SKILL_PURPOSE_LABELS[value] || value).join('、') || '未标注用途'} · {skillApplicabilityHint(skill, { task: skillTaskForPrompt(templateId, metadata?.stageType), projectFormat: currentProject?.type })}</div>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>}

                    {/* Variables */}
                    {activeTab === 'template' && Object.keys(variables).length > 0 && (
                      <div className="space-y-2.5 pt-4 border-t border-gray-200 dark:border-neutral-800">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest">
                          可用变量 (Readonly)
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.keys(variables).map(key => (
                            <span key={key} className="text-[10px] font-mono text-gray-500 dark:text-neutral-500 bg-gray-100 dark:bg-neutral-800 px-2 py-1 rounded border border-gray-200 dark:border-neutral-700 whitespace-nowrap cursor-default hover:text-gray-900 transition-colors">
                              {`{${key}}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
               </div>

               {/* Right Main Editor Area */}
               <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-neutral-950">
                  {/* Tabs */}
                  <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 dark:border-neutral-900 sm:px-6">
                     <div className="flex min-w-0 gap-1 overflow-x-auto sm:gap-6">
                        <button 
                          onClick={() => setActiveTab('preview')}
                          className={`relative flex items-center gap-1 whitespace-nowrap py-3 text-[11px] font-black transition-colors sm:gap-2 sm:py-4 sm:text-[13px] ${activeTab === 'preview' ? 'text-text-primary' : 'text-gray-500 hover:text-gray-900 dark:text-neutral-400 dark:hover:text-neutral-200'}`}
                        >
                           <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {videoGeneration ? '创作提示词' : isImageGenerationModal ? '镜头画面任务' : '最终渲染视图'}
                           {activeTab === 'preview' && <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-[2px] bg-text-primary" />}
                        </button>
                        {videoGeneration && (
                          <button
                            onClick={() => setActiveTab('references')}
                            className={`relative flex items-center gap-1 whitespace-nowrap py-3 text-[11px] font-black transition-colors sm:gap-2 sm:py-4 sm:text-[13px] ${activeTab === 'references' ? 'text-text-primary' : 'text-gray-500 hover:text-gray-900 dark:text-neutral-400 dark:hover:text-neutral-200'}`}
                          >
                            <Images className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> 引用素材
                            {activeTab === 'references' && <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-[2px] bg-text-primary" />}
                          </button>
                        )}
                        {(videoGeneration || isImageGenerationModal) && (
                          <button
                            onClick={() => setActiveTab('modelPrompt')}
                            className={`relative flex items-center gap-1 whitespace-nowrap py-3 text-[11px] font-black transition-colors sm:gap-2 sm:py-4 sm:text-[13px] ${activeTab === 'modelPrompt' ? 'text-text-primary' : 'text-gray-500 hover:text-gray-900 dark:text-neutral-400 dark:hover:text-neutral-200'}`}
                          >
                            <Code className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {isImageGenerationModal ? '模型最终提示词' : '模型提示词'}
                            {activeTab === 'modelPrompt' && <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-[2px] bg-text-primary" />}
                          </button>
                        )}
                        <button 
                          onClick={() => setActiveTab('template')}
                          className={`relative flex items-center gap-1 whitespace-nowrap py-3 text-[11px] font-black transition-colors sm:gap-2 sm:py-4 sm:text-[13px] ${activeTab === 'template' ? 'text-text-primary' : 'text-gray-500 hover:text-gray-900 dark:text-neutral-400 dark:hover:text-neutral-200'}`}
                        >
                           <Code className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> 提示词模板
                           {activeTab === 'template' && <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-[2px] bg-text-primary" />}
                        </button>
                     </div>

                     {/* Actions within header (Version count & Reset) */}
                     <div className="flex items-center gap-4">
                        {activeTab === 'preview' && currentTemplate.includes('{{versionCount}}') && (
                           <div className="flex items-center gap-2">
                             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest hidden lg:block">Proposal Count</span>
                             <div className="flex bg-gray-100 dark:bg-neutral-800 p-0.5 rounded-lg border border-gray-200 dark:border-neutral-700">
                               {[1,2,3].map(n => (
                                 <button 
                                   key={n} 
                                   onClick={() => setVersionCount(n)}
                                   className={`w-7 h-6 rounded flex items-center justify-center text-[11px] font-bold ${versionCount === n ? 'bg-white dark:bg-neutral-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                                 >
                                   {n}
                                 </button>
                               ))}
                             </div>
                           </div>
                        )}
                        {activeTab === 'template' && (
                           <div className="flex items-center gap-2">
                             <button onClick={handleResetTemplate} className="text-[11px] font-bold text-gray-500 hover:text-gray-800 flex items-center gap-1.5 bg-gray-100 dark:bg-neutral-800 px-3 py-1.5 rounded-lg transition-colors">
                               <RotateCcw className="w-3.5 h-3.5"/> 恢复默认
                             </button>
                              <button onClick={handleSaveTemplate} className="text-[11px] font-bold text-text-primary bg-bg-surface-soft hover:bg-bg-surface-hover px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
                                 <Save className="w-3.5 h-3.5"/> 保存模板
                              </button>
                           </div>
                        )}
                        {activeTab === 'modelPrompt' && selectedVideoModelOption?.supportsModelPromptOptimization && videoGeneration?.optimizeModelPrompt && (
                          <button
                            type="button"
                            onClick={() => void handleOptimizeModelPrompt()}
                            disabled={isOptimizingModelPrompt || !videoPreview}
                            title="使用任务路由中配置的分镜文本模型整理当前 MiniMax H3 提示词"
                            className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-[11px] font-bold text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                          >
                            <Sparkles className={`h-3.5 w-3.5 ${isOptimizingModelPrompt ? 'animate-pulse' : ''}`} />
                            {isOptimizingModelPrompt ? '正在整理' : '由大模型整理'}
                          </button>
                        )}
                     </div>
                  </div>

                  {isImageGenerationModal && imageVisualStyleProjection && (
                    <details className="group shrink-0 border-b border-gray-100 bg-gray-50/70 px-4 py-2 dark:border-neutral-900 dark:bg-neutral-900/45 sm:px-6">
                      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-bold text-gray-600 dark:text-neutral-300">
                        <Layers className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span className="truncate">
                          视觉继承：{imageVisualStyleProjection.artifactIntent} · {imageVisualStyleProjection.recipeId}@{imageVisualStyleProjection.recipeVersion}
                          {imageVisualStyleProjection.sourceRevision ? ` · ${imageVisualStyleProjection.sourceRevision}` : ''}
                        </span>
                        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="mt-2 grid gap-2 text-[10px] leading-5 text-gray-500 dark:text-neutral-400 lg:grid-cols-2">
                        <p className="whitespace-pre-wrap">{imageVisualStyleProjection.instruction}</p>
                        <div>
                          {imageVisualStyleProjection.includedPaths?.length ? (
                            <p><span className="font-bold text-gray-700 dark:text-neutral-200">参与：</span>{imageVisualStyleProjection.includedPaths.join('、')}</p>
                          ) : null}
                          {imageVisualStyleProjection.suppressedPaths?.length ? (
                            <p className="mt-1"><span className="font-bold text-gray-700 dark:text-neutral-200">本产物抑制：</span>{imageVisualStyleProjection.suppressedPaths.join('、')}</p>
                          ) : null}
                        </div>
                      </div>
                    </details>
                  )}

                  {/* Editor / Viewer Canvas (The real estate is maximized here) */}
                  <div className="flex min-h-0 flex-1 flex-col bg-gray-50/30 p-3 dark:bg-black/20 sm:p-6">
                    <div className="flex-1 border border-gray-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-[#0c0c0c] shadow-sm overflow-hidden flex flex-col relative focus-within:ring-1 focus-within:ring-border-primary/40 focus-within:border-border-primary/40 transition-all">
                      {activeTab === 'preview' ? (
                        <textarea
                          value={currentPrompt}
                          onChange={(e) => setCurrentPrompt(e.target.value)}
                          className="w-full h-full p-6 bg-transparent border-none resize-none outline-none text-[13px] leading-[1.8] text-gray-800 dark:text-neutral-300 custom-scrollbar"
                          placeholder="The generated prompt will appear here..."
                        />
                      ) : activeTab === 'references' ? (
                        <div className="h-full overflow-y-auto p-5 sm:p-6">
                          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                            <section>
                              <h3 className="text-xs font-black text-gray-900 dark:text-white">引用素材</h3>
                              <div className="mt-3 divide-y divide-gray-100 border-y border-gray-100 dark:divide-neutral-800 dark:border-neutral-800">
                                {videoPreview?.references.length ? videoPreview.references.map((reference) => (
                                  <div key={reference.id} className="flex min-h-16 items-center gap-3 py-3">
                                    <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100 text-[9px] font-bold text-gray-400 dark:bg-neutral-800">
                                      {reference.thumbnailUrl && reference.mediaKind === 'image'
                                        ? <img src={reference.thumbnailUrl} alt={reference.name} className="h-full w-full object-cover" />
                                        : reference.mediaKind === 'audio' ? '声音' : '视频'}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-gray-900 dark:text-white">{reference.label} · {reference.name}</p>
                                      <p className="mt-1 text-[10px] leading-4 text-gray-500">{reference.relationship}</p>
                                    </div>
                                  </div>
                                )) : <p className="py-5 text-xs text-gray-400">当前生成方式没有可发送的引用素材。</p>}
                              </div>
                            </section>
                            <section>
                              <h3 className="text-xs font-black text-gray-900 dark:text-white">镜头时间</h3>
                              <div className="mt-3 divide-y divide-gray-100 border-y border-gray-100 dark:divide-neutral-800 dark:border-neutral-800">
                                {videoPreview?.timeline.map((beat) => (
                                  <div key={beat.id} className="py-3">
                                    <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-gray-900 dark:text-white">{beat.label}</p><span className="text-[10px] font-mono text-gray-400">{beat.time}</span></div>
                                    <p className="mt-1 text-[11px] leading-5 text-gray-600 dark:text-neutral-300">{beat.action}</p>
                                    {beat.camera && <p className="mt-1 text-[10px] leading-4 text-blue-600">摄影机：{beat.camera}</p>}
                                    {beat.dialogue && <p className="mt-1 text-[10px] leading-4 text-emerald-600">对白：{beat.dialogue}</p>}
                                    {beat.sound && <p className="mt-1 text-[10px] leading-4 text-gray-500">声音：{beat.sound}</p>}
                                  </div>
                                ))}
                              </div>
                            </section>
                          </div>
                        </div>
                      ) : activeTab === 'modelPrompt' && isImageGenerationModal ? (
                        <div className="flex h-full min-h-0 flex-col">
                          {compiledImagePrompt.error && (
                            <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-xs font-bold text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
                              {compiledImagePrompt.error}
                            </div>
                          )}
                          <textarea
                            value={compiledImagePrompt.providerPrompt}
                            readOnly
                            aria-label="实际发送给图片模型的最终提示词"
                            className="h-full w-full resize-none border-none bg-transparent p-6 font-mono text-[12px] leading-[1.8] text-gray-800 outline-none dark:text-neutral-300"
                            placeholder="实际发送给图片模型的最终提示词会显示在这里"
                          />
                        </div>
                      ) : activeTab === 'modelPrompt' ? (
                        <textarea
                          value={currentModelPrompt}
                          onChange={(event) => {
                            setCurrentModelPrompt(event.target.value);
                            setModelPromptEdited(true);
                            setModelPromptSource('author_edited');
                            setPromptAuthoringModelLabel(undefined);
                          }}
                          className="h-full w-full resize-none border-none bg-transparent p-6 font-mono text-[12px] leading-[1.8] text-gray-800 outline-none dark:text-neutral-300"
                          placeholder="发送给当前视频模型的提示词会显示在这里"
                        />
                      ) : (
                        <div className="flex flex-1 flex-col lg:flex-row h-full overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-gray-200 dark:divide-neutral-800">
                          {/* Left: Free Text Template Editor */}
                          <div className="flex-1 min-w-0 h-full flex flex-col">
                            <textarea
                              className="w-full h-full p-6 bg-transparent border-none resize-none outline-none text-[13px] font-mono leading-[1.8] text-gray-700 dark:text-neutral-400 focus:text-gray-900 dark:focus:text-neutral-200 custom-scrollbar"
                              value={currentTemplate}
                              onChange={handleTemplateChange}
                              spellCheck={false}
                              placeholder="输入或修改您的提示词模板..."
                            />
                          </div>
                          
                          {/* Right: Validation, Metadata & Diagnostic Panel */}
                          <div className="w-full lg:w-[320px] shrink-0 bg-gray-50/50 dark:bg-neutral-900/50 p-5 overflow-y-auto custom-scrollbar flex flex-col space-y-6">
                            
                            {/* Metadata Details */}
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <Info className="w-3.5 h-3.5 text-text-secondary" />
                                <h4 className="text-[10px] font-black text-gray-400 dark:text-neutral-500 uppercase tracking-widest">模板基础属性</h4>
                              </div>
                              <div className="bg-white dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800/80 rounded-xl p-3 space-y-2">
                                <div className="flex justify-between text-xs">
                                  <span className="text-gray-400">模板 ID:</span>
                                  <span className="font-mono text-gray-600 dark:text-neutral-300">{templateId}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                  <span className="text-gray-400">适用阶段:</span>
                                  <span className="px-2 py-0.5 bg-bg-surface-soft text-text-primary rounded text-[10px] font-bold">
                                    {metadata?.stageType || '未声明'}
                                  </span>
                                </div>
                                <div className="flex justify-between text-xs">
                                  <span className="text-gray-400">项目类型:</span>
                                  <span className="text-gray-600 dark:text-neutral-300 font-bold">
                                    {currentProject?.type === 'movie' ? '电影' : currentProject?.type === 'tv-series' ? '剧集' : '短剧/游戏'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Missing Variables Warning */}
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                <h4 className="text-[10px] font-black text-gray-400 dark:text-neutral-500 uppercase tracking-widest">变量缺失检查</h4>
                              </div>
                              <div className="bg-white dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800/80 rounded-xl p-3.5 space-y-3">
                                {/* Core placeholders check */}
                                {requiresSelectedContext && !hasSelectedContext && (
                                  <div className="flex gap-2 text-xs text-amber-600 dark:text-amber-400 leading-snug">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>缺少上下文注入占位符 <code>{"{{selectedContext}}"}</code>，项目上下文将无法注入。</span>
                                  </div>
                                )}
                                {requiresSkills && !hasSkills && (
                                  <div className="flex gap-2 text-xs text-amber-600 dark:text-amber-400 leading-snug">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>缺少通用 Skill 注入占位符 <code>{"{{skills}}"}</code>，作者选择的 Skill 不会进入本次提示词。</span>
                                  </div>
                                )}
                                {requiresUserIntent && !hasUserIntent && (
                                  <div className="flex gap-2 text-xs text-amber-600 dark:text-amber-400 leading-snug">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>缺少意图占位符 <code>{"{{userIntent}}"}</code>，用户补充指令将失效。</span>
                                  </div>
                                )}
                                
                                {/* Parameter variables check */}
                                {missingVars.map(v => (
                                  <div key={v} className="flex gap-2 text-xs text-amber-600 dark:text-amber-400 leading-snug">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>缺少模型变量 <code>{"{{"}{v}{"}}"}</code>。</span>
                                  </div>
                                ))}

                                {(!requiresSelectedContext || hasSelectedContext) && (!requiresSkills || hasSkills) && (!requiresUserIntent || hasUserIntent) && missingVars.length === 0 && (
                                  <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle className="w-4 h-4 shrink-0" />
                                    <span>无缺失变量，结构完整。</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Output Schema Contract */}
                            {metadata && (
                              <div>
                                <div className="flex items-center gap-2 mb-3">
                                  <Layers className="w-3.5 h-3.5 text-text-secondary" />
                                  <h4 className="text-[10px] font-black text-gray-400 dark:text-neutral-500 uppercase tracking-widest">输出契约 (Output Schema)</h4>
                                </div>
                                <div className="bg-white dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800/80 rounded-xl p-3.5 space-y-2.5">
                                  <div className="text-[11px] text-gray-400">此阶段模型输出必须包含以下关键字段:</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {metadata.outputSchema.map(field => (
                                      <span key={field} className="px-2 py-1 bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-neutral-300 font-mono text-[10px] rounded border border-gray-200 dark:border-neutral-700/80">
                                        {field}
                                      </span>
                                    ))}
                                  </div>
                                  {metadata.languagePolicy && (
                                    <div className="text-[10px] bg-bg-surface-soft p-2.5 rounded text-text-primary leading-normal border border-transparent">
                                      <strong>语言策略:</strong> {metadata.languagePolicy}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Conflict & Compatibility Warnings */}
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                                <h4 className="text-[10px] font-black text-gray-400 dark:text-neutral-500 uppercase tracking-widest">兼容性与冲突项</h4>
                              </div>
                              <div className="bg-white dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800/80 rounded-xl p-3.5 space-y-3">
                                {templateConflicts.length > 0 ? (
                                  templateConflicts.map((conflict, i) => (
                                    <div key={i} className="flex gap-2 text-xs text-rose-600 dark:text-rose-400 leading-snug">
                                      <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                      <span>{conflict}</span>
                                    </div>
                                  ))
                                ) : (
                                  <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle className="w-4 h-4 shrink-0" />
                                    <span>未检测到冲突，适配性良好。</span>
                                  </div>
                                )}
                              </div>
                            </div>

                          </div>
                        </div>
                      )}
                    </div>
                  </div>

               </div>
             </div>

             {externalReferences?.length ? <div className="max-h-28 shrink-0 overflow-auto border-t border-border-soft px-4 py-2 text-xs"><p className="mb-2 text-text-muted">将以下参考素材一并提供给外部 AI：</p><div className="flex flex-wrap gap-3">{externalReferences.map((reference, index) => <a key={`${reference.url}-${index}`} href={reference.url} download target="_blank" rel="noreferrer" className="underline">{reference.label || `参考素材 ${index + 1}`}</a>)}</div></div> : null}
             <ManualAIResultField manualOnly={requireManualResult} sourcePrompt={currentPrompt} prompt={videoPreview ? currentModelPrompt : isImageGenerationModal ? compiledImagePrompt.providerPrompt : currentPrompt} value={manualResult} onChange={setManualResult} kind={manualResultKind || (videoGeneration ? "video" : isImageGenerationModal ? "image" : undefined)} projectId={currentProject?.id} disabled={isSubmitting} onBusyChange={setResultUploading} />

             {/* Footer Panel */}
             {submissionError && (
               <div role="alert" className="max-h-32 shrink-0 overflow-y-auto whitespace-pre-wrap border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                 {submissionError}
               </div>
             )}
             <div className="z-20 flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 bg-white p-3 dark:border-neutral-900 dark:bg-neutral-950 sm:gap-3 sm:p-5">
               <button
                 onClick={onCancel || onClose}
                 className="px-4 sm:px-6 py-2.5 rounded-xl text-[13px] font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-900 dark:hover:text-white transition-colors"
               >
                 {presentation === "workspace" ? "收起" : "取消"}
               </button>
               {!externalCopyOnly && <button
                 onClick={handleGenerateContent}
                 disabled={isSubmitting || resultUploading}
                  className="px-5 sm:px-8 py-2.5 rounded-xl text-[13px] font-black btn-primary active:scale-95 flex items-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
               >
                 <Send className="w-4 h-4" />
                 {isSubmitting ? '确认中...' : hasManualAIResult(manualResult) ? '确认使用手动结果' : '确认并执行'}
               </button>}
             </div>
          </motion.div>
        </motion.div>
      )}
      <SkillRecommendationModal
        key="skill-recommendation-modal"
        isOpen={isOpen && isSkillRecommendationOpen}
        title="AI 推荐通用 Skill"
        task={{
          taskLabel: title,
          stage: workflowStepId || templateId,
          projectFormat: currentProject?.type,
          targetUnitCount: (currentProject as any)?.targetUnitCount || (currentProject as any)?.episodes?.length,
          targetDurationMinutes: (currentProject as any)?.targetDurationMinutes || (activeEpisode as any)?.durationMinutes,
          blueprintSummary: [
            (currentProject as any)?.title,
            (currentProject as any)?.logline,
            (currentProject as any)?.coreConflict,
          ].filter(Boolean).join('\n'),
          currentPromptPreview: currentPrompt,
          selectedSkillIds,
        }}
        skills={generalSkills}
        categories={categories}
        initialSelectedSkillIds={selectedSkills.map(skill => skill.id)}
        onClose={() => setIsSkillRecommendationOpen(false)}
        onApply={(ids) => setSelectedSkillIds(ids)}
      />
    </AnimatePresence>,
    document.body
  );
}
