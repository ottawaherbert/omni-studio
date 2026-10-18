import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useAIConfigStore, useProjectStore } from "../clients/stateClient";
import { generateAIContent as generateAIContentRaw, generateAIImage as generateAIImageRaw } from "../clients/aiClient";
import { Type } from "../clients/aiSchemaClient";
import toastRaw from "react-hot-toast";
import { getProjectTypeLabel, formatCreativeVision, formatVisualCreativeVision, getDefaultCharacterCount } from "../utils/projectUtils";
import { safeParseAIResponse } from "../utils/aiParser";
import { gatherContextOptions } from "../utils/contextMapper";
import { ASSET_TYPES } from "../constants";
import { Asset, PlannedCharacter, Character, type Project } from "../clients/domainTypes";
import { deduplicateAssets, deduplicateCharacters } from "../utils/assetUtils";
import { summarizeUnknownError } from "../utils/logging";
import {
  extractRequiredNamedCharacters,
  extractRequiredNamedItems,
  filterMissingPlannedItems,
  mergeRequiredPlannedCharacters,
  mergeRequiredPlannedItems,
} from "../utils/explicitRosterExtraction";
import {
  buildAssetImagePrompt,
  buildAssetImageVisualRecipeInputEvidence,
  buildImageVisualStyleProjection,
  buildMultiViewImagePrompt,
  createImageGenerationReference,
  createVisualImageCandidate,
  resolveCreativeVisionVisualFallback,
  upsertVisualImageCandidate,
  visualImageCandidateSourceContentHash,
  type CompiledImageGenerationRequest,
} from "../clients/productionVisualImageClient";

const pendingProjectWrite = () => (
  useProjectStore.getState() as ReturnType<typeof useProjectStore.getState> & {
    _updateProjectLock?: Promise<void>;
  }
)._updateProjectLock;

const getInspirationContext = (project: any | null) => {
  if (!project) return '';
  
  const contexts = [
    project.originalInspiration ? `【原初创意】\n${project.originalInspiration}\n` : '',
    project.refinedInspiration ? `【系统精炼套路与核心准则】\n${project.refinedInspiration}\n` : ''
  ];

  return contexts.filter(Boolean).join('\n');
};

class StaleBibleAIProjectRequestError extends Error {
  constructor() {
    super("Bible AI project context changed");
    this.name = "StaleBibleAIProjectRequestError";
  }
}

const logBibleAIError = (label: string, error: unknown) => {
  if (error instanceof StaleBibleAIProjectRequestError) return;
  console.error(label, summarizeUnknownError(error));
};

const buildBibleAssetVisualStyleProjection = ({
  project,
  asset,
  assetType,
  variantId,
}: {
  project: Project;
  asset: Character | Asset;
  assetType: "character" | "location" | "prop" | "vfx";
  variantId?: string;
}) => buildImageVisualStyleProjection({
  project,
  intent: variantId ? "asset_state" : "asset_identity",
  target: { entityType: assetType, entityId: asset.id },
  assetOverride: asset.visualOverride,
});

const buildBibleAssetRecipeEvidence = ({
  asset,
  variantId,
}: {
  asset: Character | Asset;
  variantId?: string;
}) => {
  const identityFacts = !("type" in asset)
    ? [asset.visualIdentity, asset.boardPrompt, asset.defaultReferenceUrl, asset.referenceImageUrl]
    : [asset.description, asset.prompt, asset.boardPrompt, asset.defaultReferenceUrl, asset.imageUrl];
  const variant = variantId ? asset.variants?.find((entry) => entry.id === variantId) : undefined;
  return buildAssetImageVisualRecipeInputEvidence({
    intent: variantId ? "asset_state" : "asset_identity",
    identityFacts,
    stateDelta: variantId ? [variant?.name, variant?.description, variant?.promptModifiers] : undefined,
    identitySource: "Project.asset.canonicalIdentityFacts",
    stateSource: "Project.asset.variants.stateDelta",
  });
};

const characterRosterPromptData = (project: any) => JSON.stringify({
  characters: (project.characters || []).map((character: any) => ({
    name: character.name,
    role: character.role,
    visualIdentity: character.visualIdentity,
    psychologicalProfile: character.psychologicalProfile,
    mbti: character.mbti,
    enneagram: character.enneagram,
    vocalQuirk: character.vocalQuirk,
    internalDesire: character.internalDesire,
    externalGoal: character.externalGoal,
    flaw: character.flaw,
    sliders: character.sliders,
    actingStyle: character.actingStyle,
    arcSummary: character.arcSummary,
  })),
  relationships: (project.relationships || []).flatMap((relationship: any) => {
    const source = project.characters?.find((character: any) => character.id === relationship.sourceId);
    const target = project.characters?.find((character: any) => character.id === relationship.targetId);
    if (!source?.name || !target?.name) return [];
    return [{
      sourceName: source.name,
      targetName: target.name,
      type: relationship.type,
      description: relationship.description,
      dynamics: relationship.dynamics,
    }];
  }),
}, null, 2);

export function useBibleAI() {
  const { currentProject, updateProject: updateProjectInStore } = useProjectStore();
  // The epoch also invalidates a late A -> B -> A response whose project id matches again.
  const activeProjectIdRef = useRef<string | null>(currentProject?.id ?? null);
  const activeProjectEpochRef = useRef(0);
  const renderedProjectId = currentProject?.id ?? null;
  if (activeProjectIdRef.current !== renderedProjectId) {
    activeProjectIdRef.current = renderedProjectId;
    activeProjectEpochRef.current += 1;
  }
  const renderedProjectEpoch = activeProjectEpochRef.current;
  const isRenderedProjectContextCurrent = () => Boolean(renderedProjectId)
    && activeProjectIdRef.current === renderedProjectId
    && activeProjectEpochRef.current === renderedProjectEpoch
    && useProjectStore.getState().currentProject?.id === renderedProjectId;
  const [isGeneratingLogline, setIsGeneratingLoglineRaw] = useState(false);
  const [isGeneratingConflict, setIsGeneratingConflictRaw] = useState(false);
  const [isGeneratingCharacters, setIsGeneratingCharactersRaw] = useState(false);
  const [isGeneratingArc, setIsGeneratingArcRaw] = useState(false);
  const [isGeneratingAllAssets, setIsGeneratingAllAssetsRaw] = useState(false);
  const [isGeneratingWorldRules, setIsGeneratingWorldRulesRaw] = useState(false);
  const [generatingCharId, setGeneratingCharIdRaw] = useState<string | null>(null);
  const [generatingAssetId, setGeneratingAssetIdRaw] = useState<string | null>(null);
  const [generatingCharImageId, setGeneratingCharImageIdRaw] = useState<string | null>(null);
  const [generatingAssetImageId, setGeneratingAssetImageIdRaw] = useState<string | null>(null);
  const [isOptimizingPrompt, setIsOptimizingPromptRaw] = useState(false);
  const [isGeneratingBible, setIsGeneratingBibleRaw] = useState(false);
  const [characterValidationReport, setCharacterValidationReportRaw] = useState<{ flaws: string[], improvementPlan: string, rawResponse: any } | null>(null);

  const [promptModalState, setPromptModalStateRaw] = useState<{
    isOpen: boolean;
    projectId?: string;
    templateId: string;
    variables: Record<string, string>;
    onConfirm: (prompt: string) => void;
    contextOptions?: { id: string; label: string; value: string }[];
    defaultSelectedContextIds?: string[];
    title?: string;
  }>({
    isOpen: false,
    templateId: '',
    variables: {},
    onConfirm: () => {},
  });

  const [imagePromptModalState, setImagePromptModalStateRaw] = useState<{
    isOpen: boolean;
    projectId: string | null;
    initialPrompt: string;
    title?: string;
    confirmText?: string;
    onConfirm: (prompt: string, referenceImage?: string) => void;
  }>({
    isOpen: false,
    projectId: null,
    initialPrompt: '',
    title: 'AI 生成图片',
    confirmText: '生成图片',
    onConfirm: () => {},
  });

  const guardProjectSetter = <Value,>(setter: Dispatch<SetStateAction<Value>>) => (
    value: SetStateAction<Value>,
  ) => {
    if (isRenderedProjectContextCurrent()) setter(value);
  };
  const setIsGeneratingLogline = guardProjectSetter(setIsGeneratingLoglineRaw);
  const setIsGeneratingConflict = guardProjectSetter(setIsGeneratingConflictRaw);
  const setIsGeneratingCharacters = guardProjectSetter(setIsGeneratingCharactersRaw);
  const setIsGeneratingArc = guardProjectSetter(setIsGeneratingArcRaw);
  const setIsGeneratingAllAssets = guardProjectSetter(setIsGeneratingAllAssetsRaw);
  const setIsGeneratingWorldRules = guardProjectSetter(setIsGeneratingWorldRulesRaw);
  const setGeneratingCharId = guardProjectSetter(setGeneratingCharIdRaw);
  const setGeneratingAssetId = guardProjectSetter(setGeneratingAssetIdRaw);
  const setGeneratingCharImageId = guardProjectSetter(setGeneratingCharImageIdRaw);
  const setGeneratingAssetImageId = guardProjectSetter(setGeneratingAssetImageIdRaw);
  const setIsOptimizingPrompt = guardProjectSetter(setIsOptimizingPromptRaw);
  const setIsGeneratingBible = guardProjectSetter(setIsGeneratingBibleRaw);
  const setCharacterValidationReport = guardProjectSetter(setCharacterValidationReportRaw);
  const setPromptModalState = guardProjectSetter(setPromptModalStateRaw);
  const setImagePromptModalState = guardProjectSetter(setImagePromptModalStateRaw);

  const dismissStaleToast = (args: readonly unknown[]) => {
    const id = (args[1] as { id?: string } | undefined)?.id;
    if (id) toastRaw.dismiss(id);
  };
  const toast = {
    error: (...args: Parameters<typeof toastRaw.error>) => {
      if (!isRenderedProjectContextCurrent()) {
        dismissStaleToast(args);
        return "";
      }
      return toastRaw.error(...args);
    },
    success: (...args: Parameters<typeof toastRaw.success>) => {
      if (!isRenderedProjectContextCurrent()) {
        dismissStaleToast(args);
        return "";
      }
      return toastRaw.success(...args);
    },
    loading: (...args: Parameters<typeof toastRaw.loading>) => isRenderedProjectContextCurrent()
      ? toastRaw.loading(...args)
      : "",
    dismiss: (...args: Parameters<typeof toastRaw.dismiss>) => toastRaw.dismiss(...args),
  };

  const updateProject = (updates: Partial<Project>) => renderedProjectId
    ? updateProjectInStore(updates, { expectedProjectId: renderedProjectId })
    : Promise.resolve();
  const assertRenderedProjectContext = () => {
    if (!isRenderedProjectContextCurrent()) throw new StaleBibleAIProjectRequestError();
  };
  const generateAIContent = async (...args: Parameters<typeof generateAIContentRaw>) => {
    assertRenderedProjectContext();
    const result = await generateAIContentRaw(...args);
    assertRenderedProjectContext();
    return result;
  };
  const generateAIImage = async (...args: Parameters<typeof generateAIImageRaw>) => {
    assertRenderedProjectContext();
    const result = await generateAIImageRaw(...args);
    assertRenderedProjectContext();
    return result;
  };

  const closePromptModal = () => setPromptModalState(prev => ({ ...prev, isOpen: false }));
  const closeImagePromptModal = () => setImagePromptModalState(prev => ({ ...prev, isOpen: false }));

  useEffect(() => {
    setPromptModalStateRaw({
      isOpen: false,
      templateId: "",
      variables: {},
      onConfirm: () => {},
    });
    setImagePromptModalStateRaw({
      isOpen: false,
      projectId: null,
      initialPrompt: "",
      title: "AI 生成图片",
      confirmText: "生成图片",
      onConfirm: () => {},
    });
    setIsGeneratingLoglineRaw(false);
    setIsGeneratingConflictRaw(false);
    setIsGeneratingCharactersRaw(false);
    setIsGeneratingArcRaw(false);
    setIsGeneratingAllAssetsRaw(false);
    setIsGeneratingWorldRulesRaw(false);
    setGeneratingCharIdRaw(null);
    setGeneratingAssetIdRaw(null);
    setGeneratingCharImageIdRaw(null);
    setGeneratingAssetImageIdRaw(null);
    setIsOptimizingPromptRaw(false);
    setIsGeneratingBibleRaw(false);
    setCharacterValidationReportRaw(null);
  }, [renderedProjectId]);

  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state) => {
      const projectId = state.currentProject?.id ?? null;
      if (activeProjectIdRef.current === projectId) return;
      activeProjectIdRef.current = projectId;
      activeProjectEpochRef.current += 1;
      setPromptModalStateRaw({
        isOpen: false,
        templateId: "",
        variables: {},
        onConfirm: () => {},
      });
      setImagePromptModalStateRaw({
        isOpen: false,
        projectId: null,
        initialPrompt: "",
        title: "AI 生成图片",
        confirmText: "生成图片",
        onConfirm: () => {},
      });
      setIsGeneratingLoglineRaw(false);
      setIsGeneratingConflictRaw(false);
      setIsGeneratingCharactersRaw(false);
      setIsGeneratingArcRaw(false);
      setIsGeneratingAllAssetsRaw(false);
      setIsGeneratingWorldRulesRaw(false);
      setGeneratingCharIdRaw(null);
      setGeneratingAssetIdRaw(null);
      setGeneratingCharImageIdRaw(null);
      setGeneratingAssetImageIdRaw(null);
      setIsOptimizingPromptRaw(false);
      setIsGeneratingBibleRaw(false);
      setCharacterValidationReportRaw(null);
    });
    return unsubscribe;
  }, []);

  const captureBibleAIProjectRequest = (projectId: string) => ({
    projectId,
    projectEpoch: activeProjectEpochRef.current,
  });

  const isBibleAIProjectRequestCurrent = ({
    projectId,
    projectEpoch,
  }: {
    projectId: string;
    projectEpoch: number;
  }) => activeProjectIdRef.current === projectId
    && activeProjectEpochRef.current === projectEpoch
    && useProjectStore.getState().currentProject?.id === projectId;

  const awaitBibleAIProjectWrites = async (request: { projectId: string; projectEpoch: number }) => {
    while (isBibleAIProjectRequestCurrent(request)) {
      const pendingWrite = pendingProjectWrite();
      if (pendingWrite) await pendingWrite;
      if (!isBibleAIProjectRequestCurrent(request)) return false;
      if (pendingProjectWrite() === pendingWrite) return true;
    }
    return false;
  };

  const stageVisualImageCandidate = async ({
    projectId,
    projectEpoch,
    assetId,
    isCharacter,
    kind,
    variantId,
    imageUrl,
    prompt,
    compiledRequest,
    sourceContentHash,
  }: {
    projectId: string;
    projectEpoch: number;
    assetId: string;
    isCharacter: boolean;
    kind: "base" | "multiview" | "variant";
    variantId?: string;
    imageUrl: string;
    prompt: string;
    compiledRequest?: CompiledImageGenerationRequest;
    sourceContentHash: string;
  }): Promise<boolean> => {
    const projectRequest = { projectId, projectEpoch };
    if (!await awaitBibleAIProjectWrites(projectRequest)) return false;
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject || !isBibleAIProjectRequestCurrent({ projectId, projectEpoch })) return false;
    const targetExists = isCharacter
      ? latestProject.characters.some((character) => character.id === assetId
        && (!variantId || character.variants?.some((variant) => variant.id === variantId)))
      : latestProject.assets.some((asset) => asset.id === assetId
        && (!variantId || asset.variants?.some((variant) => variant.id === variantId)));
    if (!targetExists) return false;
    const latestOwner = isCharacter
      ? latestProject.characters.find((character) => character.id === assetId)
      : latestProject.assets.find((asset) => asset.id === assetId);
    if (!latestOwner) return false;
    const candidate = createVisualImageCandidate({
      kind,
      variantId,
      imageUrl,
      prompt,
      compiledRequest,
      sourceContentHash,
      modelId: useAIConfigStore.getState().routing.imageGen,
    });
    if (isCharacter) {
      await updateProject({
        characters: latestProject.characters.map((character) => character.id === assetId
          ? { ...character, visualImageCandidates: upsertVisualImageCandidate(latestOwner.visualImageCandidates, candidate) }
          : character),
      });
    } else {
      await updateProject({
        assets: latestProject.assets.map((asset) => asset.id === assetId
          ? { ...asset, visualImageCandidates: upsertVisualImageCandidate(latestOwner.visualImageCandidates, candidate) }
          : asset),
      });
    }
    return isBibleAIProjectRequestCurrent({ projectId, projectEpoch });
  };

  const handleRegenerateLogline = () => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;

    if (!latestProject.coreConflict && !latestProject.creativeVision) {
      toast.error("缺乏核心冲突或创作愿景，AI 难以生成高质量 Logline", { icon: "⚠️" });
    }

    

    const loglineContext = gatherContextOptions(latestProject, 'regenerateLogline');
    setPromptModalState({
      isOpen: true,
      templateId: 'regenerateLogline',
      variables: {
        type: getProjectTypeLabel(latestProject.type),
        coreConflict: latestProject.coreConflict,
        creativeVision: formatCreativeVision(latestProject.creativeVision),
        inspirationContext: getInspirationContext(latestProject)
      },
      contextOptions: loglineContext.options,
      defaultSelectedContextIds: [],
      onConfirm: async (finalPrompt) => {
        setIsGeneratingLogline(true);
        try {
          const response = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: { logline: { type: Type.STRING } },
              required: ["logline"]
            }
          });
          const result = safeParseAIResponse(response, { logline: "" });
          if (result.logline) {
            updateProject({ logline: result.logline });
            toast.success("Logline 重写成功！");
          }
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("生成失败，请重试");
        } finally {
          setIsGeneratingLogline(false);
        }
      }
    });
  };

  const handleRegenerateConflict = () => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;

    if (!latestProject.logline) {
      toast.error("先完成一句话故事 (Logline) 可以让 AI 生成更精准的冲突", { icon: "⚠️" });
    }

    

    const conflictContext = gatherContextOptions(latestProject, 'regenerateConflict');
    setPromptModalState({
      isOpen: true,
      templateId: 'regenerateConflict',
      variables: {
        type: getProjectTypeLabel(latestProject.type),
        logline: latestProject.logline,
        creativeVision: formatCreativeVision(latestProject.creativeVision),
        inspirationContext: getInspirationContext(latestProject)
      },
      contextOptions: conflictContext.options,
      defaultSelectedContextIds: [],
      onConfirm: async (finalPrompt) => {
        setIsGeneratingConflict(true);
        try {
          const response = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                want: { type: Type.STRING },
                need: { type: Type.STRING },
                antagonism: { type: Type.STRING },
                stakes: { type: Type.STRING }
              },
              required: ["want", "need", "antagonism", "stakes"]
            }
          });
          const result = safeParseAIResponse(response, { want: "", need: "", antagonism: "", stakes: "" });
          if (result.want || result.need || result.antagonism || result.stakes) {
            const serialized = `【外部目标】${result.want}\n\n【内在缺失】${result.need}\n\n【对抗力量】${result.antagonism}\n\n【终极代价】${result.stakes}`;
            updateProject({ coreConflict: serialized });
            toast.success("核心冲突重写成功！");
          }
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("生成失败，请重试");
        } finally {
          setIsGeneratingConflict(false);
        }
      }
    });
  };

  const handleRegenerateArc = () => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;

    const worldBuildingRules = latestProject.worldBuildingRules && latestProject.worldBuildingRules.length > 0
      ? latestProject.worldBuildingRules.map((r: any) => `- ${r.category}: ${r.content}`).join('\n')
      : "";

    const relationships = latestProject.relationships && latestProject.relationships.length > 0
      ? latestProject.relationships.map((r: any) => {
          const sourceChar = latestProject.characters.find((c: any) => c.id === r.sourceId);
          const targetChar = latestProject.characters.find((c: any) => c.id === r.targetId);
          if (!sourceChar?.name || !targetChar?.name) return "";
          return `- ${sourceChar.name} -> ${targetChar.name}: [${r.type}] ${r.description}`;
        }).filter(Boolean).join('\n')
      : "";

    

    const arcContext = gatherContextOptions(latestProject, 'regenerateArc');
    setPromptModalState({
      isOpen: true,
      templateId: 'regenerateArc',
      variables: {
        type: getProjectTypeLabel(latestProject.type),
        targetEpisodeCount: latestProject.targetEpisodeCount ? latestProject.targetEpisodeCount.toString() : "",
        logline: latestProject.logline,
        coreConflict: latestProject.coreConflict,
        creativeVision: formatCreativeVision(latestProject.creativeVision),
        worldBuildingRules,
        relationships,
        inspirationContext: getInspirationContext(latestProject)
      },
      contextOptions: arcContext.options,
      defaultSelectedContextIds: arcContext.defaultIds.filter((id) => id.startsWith("ctx_char_")),
      onConfirm: async (finalPrompt) => {
        setIsGeneratingArc(true);
        try {
          const response = await generateAIContent({ prompt: finalPrompt });
          updateProject({ seasonArc: response });
          toast.success("故事主线/钩子重写成功！");
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("生成失败，请重试");
        } finally {
          setIsGeneratingArc(false);
        }
      }
    });
  };

  const handlePlanCharacterRoster = () => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) {
      toast.error("请先打开一个项目，再生成角色阵容。");
      return;
    }

    if (!latestProject.logline || !latestProject.coreConflict) {
      toast.error("请先完善项目的 Logline 或核心冲突，否则生成的阵容图可能缺乏深度", { icon: "⚠️" });
    }

    const { options: contextOptions, defaultIds: defaultSelectedContextIds } = gatherContextOptions(latestProject, "planCharacterRoster");
    const counts = latestProject.characterCountConfig || getDefaultCharacterCount(latestProject.type, latestProject.durationMinutes);
    const totalCount = counts.leads + counts.supporting + counts.extras;
    const requiredNamedCharacters = extractRequiredNamedCharacters(latestProject);

    setPromptModalState({
      isOpen: true,
      templateId: 'planCharacterRoster',
      variables: {
        inspirationContext: getInspirationContext(latestProject),
        type: getProjectTypeLabel(latestProject.type),
        leadsCount: counts.leads.toString(),
        supportingCount: counts.supporting.toString(),
        extrasCount: counts.extras.toString(),
        totalCount: totalCount.toString(),
        requiredNamedCharacters: requiredNamedCharacters.length > 0
          ? requiredNamedCharacters.map((character) => `- ${character.name}: ${character.brief}`).join('\n')
          : ""
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setIsGeneratingCharacters(true);
        const toastId = toast.loading('正在推演预设阵容画像...');
        try {
          const response = await generateAIContent({ 
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                plannedCharacters: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      roleType: { type: Type.STRING },
                      brief: { type: Type.STRING },
                    },
                    required: ["name", "roleType", "brief"]
                  }
                }
              },
              required: ["plannedCharacters"]
            }
          });
          
          let parsedData = safeParseAIResponse(response, { plannedCharacters: [] });
          // Assign unique IDs to planned characters
          const modelPlanned = parsedData.plannedCharacters.map((c: any) => ({
            id: 'char_' + Date.now() + Math.random().toString(36).substring(2, 6),
            name: c.name,
            roleType: c.roleType || 'supporting',
            brief: c.brief,
            isDetailed: false
          }));
          const finalPlanned = mergeRequiredPlannedCharacters(modelPlanned, requiredNamedCharacters);

          updateProject({ plannedCharacters: finalPlanned, characterCountConfig: counts });
          toast.success("预设阵容规划成功！", { id: toastId });
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("规划阵容失败，请重试", { id: toastId });
        } finally {
          setIsGeneratingCharacters(false);
        }
      }
    });
  };

  const handleGenerateCharacters = (targetRoles?: PlannedCharacter[]) => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) {
      toast.error("请先打开一个项目，再生成角色档案。");
      return;
    }

    if (!latestProject.logline || !latestProject.coreConflict) {
      toast.error("请先完善项目的 Logline 或核心冲突，否则生成的角色可能缺乏深度", { icon: "⚠️" });
    }

    const { options: contextOptions, defaultIds } = gatherContextOptions(latestProject, "generateCharacters");
    const defaultSelectedContextIds = defaultIds.filter((id) => id !== "ctx_inspiration" && !id.startsWith("ctx_char_"));

    const existingCharacters = latestProject.characters && latestProject.characters.length > 0
      ? latestProject.characters.map((c: Character) => c.name).join(', ')
      : "";
      
    // Format characterRosterPlan correctly whether it's an array or string
    let formattedRosterPlan = '';
    if (latestProject.plannedCharacters && latestProject.plannedCharacters.length > 0) {
      formattedRosterPlan = latestProject.plannedCharacters.map((c: PlannedCharacter) => `- [${c.roleType}] ${c.name}: ${c.brief}`).join('\n');
    } else if (latestProject.characterRosterPlan) {
      formattedRosterPlan = latestProject.characterRosterPlan;
    }

    // Determine what we're generating
    let targetGenerationList = '(智能发散，请为项目生成最核心的初始角色)';
    if (targetRoles && targetRoles.length > 0) {
      targetGenerationList = targetRoles.map(r => `- [${r.roleType}] ${r.name}: ${r.brief}`).join('\n');
    }

    setPromptModalState({
      isOpen: true,
      templateId: 'generateCharacters',
      variables: {
        inspirationContext: getInspirationContext(latestProject),
        type: getProjectTypeLabel(latestProject.type),
        existingCharacters,
        characterRosterPlan: formattedRosterPlan,
        targetGenerationList
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setIsGeneratingCharacters(true);
        const toastId = toast.loading('Step 1: 正在生成初始角色档案...');
        try {
          const response1 = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                characters: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      psychologicalProfile: { type: Type.STRING },
                      name: { type: Type.STRING },
                      mbti: { type: Type.STRING },
                      enneagram: { type: Type.STRING },
                      vocalQuirk: { type: Type.STRING },
                      internalDesire: { type: Type.STRING },
                      externalGoal: { type: Type.STRING },
                      flaw: { type: Type.STRING },
                      sliders: { type: Type.OBJECT }
                    },
                    required: ["psychologicalProfile", "name", "internalDesire", "externalGoal", "flaw"]
                  }
                },
                relationships: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      sourceName: { type: Type.STRING },
                      targetName: { type: Type.STRING },
                      type: { type: Type.STRING },
                      description: { type: Type.STRING },
                      dynamics: { type: Type.OBJECT }
                    },
                    required: ["sourceName", "targetName", "type", "description"]
                  }
                }
              },
              required: ["characters"]
            }
          });
          
          let result = safeParseAIResponse(response1, { characters: [], relationships: [] });
          
          if (result.characters && Array.isArray(result.characters)) {
            const latestProject = useProjectStore.getState().currentProject;
            if (latestProject) {
              const existingCharacters = latestProject.characters || [];
              const uniqueNewCharacters = deduplicateCharacters(existingCharacters, result.characters);
              
              const newCharactersWithIds = uniqueNewCharacters.map((c: any) => ({
                ...c,
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
              }));
              
              const allCharacters = [...existingCharacters, ...newCharactersWithIds];

              const relationshipsWithIds = (result.relationships || []).map((r: any) => {
                const sourceChar = allCharacters.find(c => c.name === r.sourceName);
                const targetChar = allCharacters.find(c => c.name === r.targetName);
                if (sourceChar && targetChar) {
                  return {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                    sourceId: sourceChar.id,
                    targetId: targetChar.id,
                    type: r.type,
                    description: r.description,
                    dynamics: r.dynamics
                  };
                }
                return null;
              }).filter(Boolean);

              // Update isDetailed flag on plannedCharacters
              const newPlannedCharacters = (latestProject.plannedCharacters || []).map(pc => {
                if (targetRoles && targetRoles.find(r => r.id === pc.id)) {
                  return { ...pc, isDetailed: true };
                }
                return pc;
              });

              updateProject({ 
                characters: allCharacters,
                relationships: [...(latestProject.relationships || []), ...relationshipsWithIds],
                plannedCharacters: newPlannedCharacters
              });
              
              toast.success(`初始角色生成完成，已保存 ${newCharactersWithIds.length} 个角色。可以手动点击角色检查进行下一步操作。`, { id: toastId });
            }
          } else {
             toast.error("初始角色生成返回数据异常", { id: toastId });
          }
          
          setIsGeneratingCharacters(false);

        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("初始阶段出错，请重试", { id: toastId });
          setIsGeneratingCharacters(false);
        }
      }
    });
  };

  const handleValidateAndRefineCharacters = () => {
    if (!currentProject || !currentProject.characters || currentProject.characters.length === 0) {
      toast.error("无可用的角色档案进行自检，请先生成初始角色。");
      return;
    }

    const { options, defaultIds } = gatherContextOptions(currentProject, "validateCharacters");
    const dataStr = characterRosterPromptData(currentProject);

    setPromptModalState({
      isOpen: true,
      templateId: 'validateCharacters',
      title: '角色检查 (诊断报告)',
      variables: {
        inspirationContext: getInspirationContext(currentProject),
        type: getProjectTypeLabel(currentProject.type),
        generatedData: dataStr,
        userIntent: "请对以上角色阵容进行深度的角色检查，指出潜在的人格冲突、戏剧性缺失或逻辑漏洞。"
      },
      contextOptions: options,
      defaultSelectedContextIds: defaultIds.filter((id) => id !== "ctx_inspiration" && !id.startsWith("ctx_char_")),
      onConfirm: async (finalPrompt) => {
        setIsGeneratingCharacters(true);
        const toastId2 = toast.loading('正在进行严苛的角色检查与校准...');
        
        try {
          const response2 = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                flaws: { type: Type.ARRAY, items: { type: Type.STRING } },
                improvementPlan: { type: Type.STRING }
              },
              required: ["flaws", "improvementPlan"]
            }
          });
          
          const parsedResponse2 = safeParseAIResponse(response2, { flaws: [], improvementPlan: "" });

          toast.success("角色检查完成，请查看报告", { id: toastId2 });
          setCharacterValidationReport({
            flaws: parsedResponse2.flaws || [],
            improvementPlan: parsedResponse2.improvementPlan || "",
            rawResponse: parsedResponse2
          });
          
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("验证阶段出错，请重试", { id: toastId2 });
        } finally {
          setIsGeneratingCharacters(false);
        }
      }
    });
  };

  const handleApplyCharacterRefinement = async () => {
    if (!currentProject || !characterValidationReport) return;
    
    const baseInspiration = getInspirationContext(currentProject || (useProjectStore.getState().currentProject as any));
    const { options, defaultIds } = gatherContextOptions(currentProject, "refineCharacters");
    const dataStr = characterRosterPromptData(currentProject);
    
    setPromptModalState({
      isOpen: true,
      templateId: 'refineCharacters',
      title: '角色检查修正 (精装角色)',
      variables: {
        inspirationContext: baseInspiration,
        generatedData: dataStr,
        feedback: JSON.stringify(characterValidationReport.rawResponse, null, 2)
      },
      contextOptions: options,
      defaultSelectedContextIds: defaultIds.filter((id) => id !== "ctx_inspiration" && !id.startsWith("ctx_char_")),
      onConfirm: async (finalPrompt) => {
        setIsGeneratingCharacters(true);
        const toastId3 = toast.loading('正在基于反馈精装修正...');
        
        try {
          const response3 = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                characters: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      psychologicalProfile: { type: Type.STRING },
                      name: { type: Type.STRING },
                      mbti: { type: Type.STRING },
                      enneagram: { type: Type.STRING },
                      vocalQuirk: { type: Type.STRING },
                      internalDesire: { type: Type.STRING },
                      externalGoal: { type: Type.STRING },
                      flaw: { type: Type.STRING },
                      sliders: { type: Type.OBJECT }
                    },
                    required: ["psychologicalProfile", "name", "internalDesire", "externalGoal", "flaw"]
                  }
                },
                relationships: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      sourceName: { type: Type.STRING },
                      targetName: { type: Type.STRING },
                      type: { type: Type.STRING },
                      description: { type: Type.STRING },
                      dynamics: { type: Type.OBJECT }
                    },
                    required: ["sourceName", "targetName", "type", "description"]
                  }
                }
              },
              required: ["characters"]
            }
          });
          
          let refinedResult = safeParseAIResponse(response3, { characters: [], relationships: [] });

          if (refinedResult.characters && Array.isArray(refinedResult.characters)) {
            const latestProject = useProjectStore.getState().currentProject;
            if (latestProject) {
              let existingCharacters = [...(latestProject.characters || [])];
              
              // Merge or add refined characters
              refinedResult.characters.forEach((c: any) => {
                const existingIndex = existingCharacters.findIndex(ec => ec.name.trim().toLowerCase() === c.name.trim().toLowerCase());
                if (existingIndex >= 0) {
                  // Preserve ID, update data
                  existingCharacters[existingIndex] = { ...existingCharacters[existingIndex], ...c };
                } else {
                  // Add as new if they renamed it or something
                  existingCharacters.push({
                    ...c,
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
                  });
                }
              });

              // Relationships merge
              let existingRelationships = [...(latestProject.relationships || [])];
              const refinedRelationshipsWithIds = (refinedResult.relationships || []).map((r: any) => {
                const sourceChar = existingCharacters.find(c => c.name === r.sourceName);
                const targetChar = existingCharacters.find(c => c.name === r.targetName);
                if (sourceChar && targetChar) {
                  return {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                    sourceId: sourceChar.id,
                    targetId: targetChar.id,
                    type: r.type,
                    description: r.description,
                    dynamics: r.dynamics
                  };
                }
                return null;
              }).filter(Boolean);
            
              refinedRelationshipsWithIds.forEach((newRel: any) => {
                const existingIndex = existingRelationships.findIndex(er => er.sourceId === newRel.sourceId && er.targetId === newRel.targetId);
                if (existingIndex >= 0) {
                  existingRelationships[existingIndex] = newRel;
                } else {
                  existingRelationships.push(newRel);
                }
              });

              updateProject({ 
                characters: existingCharacters,
                relationships: existingRelationships
              });
              
              toast.success(`成功应用角色精修与优化！`, { id: toastId3 });
              setCharacterValidationReport(null); // finish flow
            }
          } else {
            toast.dismiss(toastId3);
          }
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("角色淬炼失败，请重试", { id: toastId3 });
        } finally {
          setIsGeneratingCharacters(false);
        }
      }
    });
  };

  const handleRegenerateCharacter = (charId: string, currentName: string) => {
    if (!currentProject) return;

    const { options: contextOptions, defaultIds } = gatherContextOptions(currentProject, "regenerateCharacter");
    const defaultSelectedContextIds = defaultIds.filter((id) => [
      `ctx_char_${charId}`,
      "ctx_logline",
      "ctx_coreConflict",
      "ctx_worldRules",
      "ctx_relationships",
    ].includes(id));

    setPromptModalState({
      isOpen: true,
      templateId: 'regenerateCharacter',
      variables: {
        inspirationContext: getInspirationContext(currentProject || (currentProject)),
        characterName: currentName ? `角色名：${currentName}` : '',
        type: getProjectTypeLabel(currentProject.type),
        creativeVision: formatCreativeVision(currentProject.creativeVision),
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setGeneratingCharId(charId);
        try {
          const response = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                visualIdentity: { type: Type.STRING, description: "角色稳定可见身份锚点，不包含角色板版式指令" },
                psychologicalProfile: { type: Type.STRING },
                mbti: { type: Type.STRING, description: "MBTI 16型人格中的一种，如 INTJ, ENFP" },
                enneagram: { type: Type.STRING, description: "九型人格侧写，如 4w5, 8w7" },
                vocalQuirk: { type: Type.STRING, description: "说话怪癖，如 反问、冷笑、拖长音" },
                sliders: { 
                  type: Type.OBJECT, 
                  description: "5个情绪滑块维度，键为维度名称，值为0到10之间的整数（例如 {'愤怒倾向': 8, '同理心': 3} 等）",
                  additionalProperties: { type: Type.INTEGER } 
                },
                internalDesire: { type: Type.STRING },
                externalGoal: { type: Type.STRING },
                flaw: { type: Type.STRING },
                actingStyle: { type: Type.STRING },
              },
              required: ["name", "visualIdentity", "psychologicalProfile", "mbti", "enneagram", "vocalQuirk", "sliders", "internalDesire", "externalGoal", "flaw", "actingStyle"]
            }
          });
          const result = safeParseAIResponse(response, {
            name: "",
            visualIdentity: "",
            psychologicalProfile: "",
            mbti: "",
            enneagram: "",
            vocalQuirk: "",
            sliders: {},
            internalDesire: "",
            externalGoal: "",
            flaw: "",
            actingStyle: "",
          });
          
          const latestProject = useProjectStore.getState().currentProject;
          if (!latestProject) return;

          const newChars = latestProject.characters.map(c => {
            if (c.id === charId) {
              return {
                ...c,
                name: result.name || c.name,
                visualIdentity: result.visualIdentity || c.visualIdentity,
                psychologicalProfile: result.psychologicalProfile || c.psychologicalProfile,
                mbti: result.mbti || c.mbti,
                enneagram: result.enneagram || c.enneagram,
                vocalQuirk: result.vocalQuirk || c.vocalQuirk,
                sliders: Object.keys(result.sliders || {}).length > 0 ? result.sliders : c.sliders,
                internalDesire: result.internalDesire || c.internalDesire,
                externalGoal: result.externalGoal || c.externalGoal,
                flaw: result.flaw || c.flaw,
                actingStyle: result.actingStyle || c.actingStyle,
              };
            }
            return c;
          });
          updateProject({ characters: newChars });
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("生成失败，请重试");
        } finally {
          setGeneratingCharId(null);
        }
      }
    });
  };

  const handleEstimateAssetCount = () => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;

    const { options: contextOptions, defaultIds: defaultSelectedContextIds } = gatherContextOptions(latestProject, "estimateAssetCount");

    setPromptModalState({
      isOpen: true,
      templateId: 'estimateAssetCount',
      title: '场景与道具数量估算',
      variables: {
        inspirationContext: getInspirationContext(latestProject),
        type: getProjectTypeLabel(latestProject.type),
        duration: latestProject.durationMinutes ? `${latestProject.durationMinutes}分钟` : '',
        userIntent: "请根据上述项目信息，帮我估算该项目在核心场景、关键道具上的合理数量范围，并给出一个推荐的精确数量（作为初始生成的参考目标）。"
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        const toastId = toast.loading('正在估算资产数量...');
        try {
          const response = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                locations: { type: Type.INTEGER, description: "推荐的核心场景数量" },
                props: { type: Type.INTEGER, description: "推荐的关键道具数量" },
                reasoning: { type: Type.STRING, description: "估算理由和逻辑说明" }
              },
              required: ["locations", "props", "reasoning"]
            }
          });
          
          const parsed = safeParseAIResponse(response, { locations: 5, props: 5, reasoning: "" });
          
          updateProject({
            assetCountConfig: {
              locations: parsed.locations || 5,
              props: parsed.props || 5,
              reasoning: parsed.reasoning || ""
            }
          });
          
          toast.success('估算完成！', { id: toastId });
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("估算失败，请重试", { id: toastId });
        }
      }
    });
  };

  const handlePlanLocationRoster = () => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) {
      toast.error("请先打开一个项目，再规划核心场景。");
      return;
    }

    if (!latestProject.logline || !latestProject.coreConflict) {
      toast.error("请先完善项目的 Logline 或核心冲突，否则生成的场景规划可能缺乏深度", { icon: "⚠️" });
    }

    const { options: contextOptions, defaultIds: defaultSelectedContextIds } = gatherContextOptions(latestProject, "planLocationRoster");
    const count = latestProject.assetCountConfig?.locations || 10;
    const requiredNamedLocations = extractRequiredNamedItems(
      latestProject,
      ["关键场景", "核心场景", "场景"],
      "location",
      "用户原始输入中明确点名的核心场景，必须纳入场景规划并保持跨集连续。",
    );

    setPromptModalState({
      isOpen: true,
      templateId: 'planLocationRoster',
      variables: {
        inspirationContext: getInspirationContext(latestProject),
        type: getProjectTypeLabel(latestProject.type),
        locationsCount: count.toString(),
        requiredNamedLocations: requiredNamedLocations.length > 0
          ? requiredNamedLocations.map((location) => `- ${location.name}: ${location.brief}`).join('\n')
          : ""
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setIsGeneratingAllAssets(true);
        const toastId = toast.loading('正在推演预设场景画像...');
        try {
          const response = await generateAIContent({ 
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                plannedLocations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      brief: { type: Type.STRING },
                    },
                    required: ["name", "brief"]
                  }
                }
              },
              required: ["plannedLocations"]
            }
          });
          
          let parsedData = safeParseAIResponse(response, { plannedLocations: [] });
          const modelPlanned = parsedData.plannedLocations.map((c: any) => ({
            id: 'loc_' + Date.now() + Math.random().toString(36).substring(2, 6),
            name: c.name,
            type: 'location' as const,
            brief: c.brief,
            isDetailed: false
          }));
          const projectAtApply = useProjectStore.getState().currentProject || latestProject;
          const existingPlanned = projectAtApply.plannedLocations || [];
          const finalPlanned = filterMissingPlannedItems(
            existingPlanned,
            mergeRequiredPlannedItems(modelPlanned, requiredNamedLocations as any[]),
          );

          updateProject({
            plannedLocations: [...existingPlanned, ...finalPlanned]
          });
          
          toast.success("场景规划推演完成！", { id: toastId });
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("规划失败，请重试", { id: toastId });
        } finally {
          setIsGeneratingAllAssets(false);
          setPromptModalState(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  const handlePlanPropRoster = () => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) {
      toast.error("请先打开一个项目，再规划关键道具。");
      return;
    }

    if (!latestProject.logline || !latestProject.coreConflict) {
      toast.error("请先完善项目的 Logline 或核心冲突", { icon: "⚠️" });
    }

    const { options: contextOptions, defaultIds: defaultSelectedContextIds } = gatherContextOptions(latestProject, "planPropRoster");
    const count = latestProject.assetCountConfig?.props || 15;
    const requiredNamedProps = extractRequiredNamedItems(
      latestProject,
      ["关键道具", "核心道具", "道具"],
      "prop",
      "用户原始输入中明确点名的关键道具，必须纳入道具规划并保持跨集连续。",
    );

    setPromptModalState({
      isOpen: true,
      templateId: 'planPropRoster',
      variables: {
        inspirationContext: getInspirationContext(latestProject),
        type: getProjectTypeLabel(latestProject.type),
        propsCount: count.toString(),
        requiredNamedProps: requiredNamedProps.length > 0
          ? requiredNamedProps.map((prop) => `- ${prop.name}: ${prop.brief}`).join('\n')
          : ""
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setIsGeneratingAllAssets(true);
        const toastId = toast.loading('正在推演预设道具画像...');
        try {
          const response = await generateAIContent({ 
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                plannedProps: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      brief: { type: Type.STRING },
                    },
                    required: ["name", "brief"]
                  }
                }
              },
              required: ["plannedProps"]
            }
          });
          
          let parsedData = safeParseAIResponse(response, { plannedProps: [] });
          const modelPlanned = parsedData.plannedProps.map((c: any) => ({
            id: 'prop_' + Date.now() + Math.random().toString(36).substring(2, 6),
            name: c.name,
            type: 'prop' as const,
            brief: c.brief,
            isDetailed: false
          }));
          const projectAtApply = useProjectStore.getState().currentProject || latestProject;
          const existingPlanned = projectAtApply.plannedProps || [];
          const finalPlanned = filterMissingPlannedItems(
            existingPlanned,
            mergeRequiredPlannedItems(modelPlanned, requiredNamedProps as any[]),
          );

          updateProject({
            plannedProps: [...existingPlanned, ...finalPlanned]
          });
          
          toast.success("道具规划推演完成！", { id: toastId });
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("规划失败，请重试", { id: toastId });
        } finally {
          setIsGeneratingAllAssets(false);
          setPromptModalState(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  const handleGenerateLocations = (targetRoles?: any[]) => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) {
      toast.error("请先打开一个项目，再生成核心场景。");
      return;
    }

    const { options: contextOptions, defaultIds: defaultSelectedContextIds } = gatherContextOptions(latestProject, "generateLocations");

    let targetGenerationList = '(智能发散，请为项目生成最核心的初始场景)';
    if (targetRoles && targetRoles.length > 0) {
      targetGenerationList = targetRoles.map(r => "- " + r.name + ": " + r.brief).join('\n');
    }

    setPromptModalState({
      isOpen: true,
      templateId: 'generateLocations',
      variables: {
        inspirationContext: getInspirationContext(latestProject),
        type: getProjectTypeLabel(latestProject.type),
        targetGenerationList
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setIsGeneratingAllAssets(true);
        const toastId = toast.loading('正在生成核心场景档案...');
        try {
          const response = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                locations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      description: { type: Type.STRING },
                      prompt: { type: Type.STRING },
                      tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      panoramaPrompt: { type: Type.STRING }
                    },
                    required: ["name", "description"]
                  }
                }
              },
              required: ["locations"]
            }
          });
          
          let parsedData = safeParseAIResponse(response, { locations: [] });
          
          const newLocations = parsedData.locations.map((loc: any) => ({
            id: 'loc_' + Date.now() + Math.random().toString(36).substring(2, 6),
            type: 'location' as const,
            name: loc.name,
            description: loc.description || '',
            prompt: loc.prompt || '',
            panoramaPrompt: loc.panoramaPrompt || '',
            tags: loc.tags || [],
          }));

          const projectAtApply = useProjectStore.getState().currentProject || latestProject;
          let updatedPlannedLocations = [...(projectAtApply.plannedLocations || [])];
          if (targetRoles && targetRoles.length > 0) {
            updatedPlannedLocations = updatedPlannedLocations.map(p => 
              targetRoles.some(t => t.id === p.id) ? { ...p, isDetailed: true } : p
            );
          }

          updateProject({
            assets: [...(projectAtApply.assets || []), ...newLocations],
            plannedLocations: updatedPlannedLocations
          });
          
          toast.success("场景生成成功！", { id: toastId });
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("场景生成失败", { id: toastId });
        } finally {
          setIsGeneratingAllAssets(false);
          setPromptModalState(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  const handleGenerateProps = (targetRoles?: any[]) => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) {
      toast.error("请先打开一个项目，再生成关键道具。");
      return;
    }

    const { options: contextOptions, defaultIds: defaultSelectedContextIds } = gatherContextOptions(latestProject, "generateProps");

    let targetGenerationList = '(智能发散，请为项目生成最核心的初始道具)';
    if (targetRoles && targetRoles.length > 0) {
      targetGenerationList = targetRoles.map(r => "- " + r.name + ": " + r.brief).join('\n');
    }

    setPromptModalState({
      isOpen: true,
      templateId: 'generateProps',
      variables: {
        inspirationContext: getInspirationContext(latestProject),
        type: getProjectTypeLabel(latestProject.type),
        targetGenerationList
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setIsGeneratingAllAssets(true);
        const toastId = toast.loading('正在生成关键道具档案...');
        try {
          const response = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                props: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      description: { type: Type.STRING },
                      prompt: { type: Type.STRING },
                      tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      multiViewPrompt: { type: Type.STRING }
                    },
                    required: ["name", "description"]
                  }
                }
              },
              required: ["props"]
            }
          });
          
          let parsedData = safeParseAIResponse(response, { props: [] });
          
          const newProps = parsedData.props.map((prop: any) => ({
            id: 'prop_' + Date.now() + Math.random().toString(36).substring(2, 6),
            type: 'prop' as const,
            name: prop.name,
            description: prop.description || '',
            prompt: prop.prompt || '',
            multiViewPrompt: prop.multiViewPrompt || '',
            tags: prop.tags || [],
          }));

          const projectAtApply = useProjectStore.getState().currentProject || latestProject;
          let updatedPlannedProps = [...(projectAtApply.plannedProps || [])];
          if (targetRoles && targetRoles.length > 0) {
            updatedPlannedProps = updatedPlannedProps.map(p => 
              targetRoles.some(t => t.id === p.id) ? { ...p, isDetailed: true } : p
            );
          }

          updateProject({
            assets: [...(projectAtApply.assets || []), ...newProps],
            plannedProps: updatedPlannedProps
          });
          
          toast.success("道具生成成功！", { id: toastId });
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("道具生成失败", { id: toastId });
        } finally {
          setIsGeneratingAllAssets(false);
          setPromptModalState(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  const handleGenerateAllAssets = () => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject || isGeneratingAllAssets) return;

    if (latestProject.characters.length === 0) {
      toast.error("建议先生成核心角色，这样 AI 能根据人物足迹生成更具关联性的场景和道具", { icon: "⚠️" });
    }
    
    const { options: contextOptions, defaultIds } = gatherContextOptions(latestProject, "generateAllAssets");
    const defaultSelectedContextIds = defaultIds.filter((id) => id !== "ctx_inspiration");

    const existingLocations = latestProject.assets
      .filter(a => a.type === ASSET_TYPES.LOCATION)
      .map(a => a.name)
      .join(', ') || "";
    
    const existingProps = latestProject.assets
      .filter(a => a.type === ASSET_TYPES.PROP)
      .map(a => a.name)
      .join(', ') || "";

    setPromptModalState({
      isOpen: true,
      templateId: 'generateAllAssets',
      variables: {
        inspirationContext: getInspirationContext(latestProject),
        type: getProjectTypeLabel(latestProject.type),
        existingLocations,
        existingProps,
        assetCountConfigLocations: String(latestProject.assetCountConfig?.locations || 5),
        assetCountConfigProps: String(latestProject.assetCountConfig?.props || 5)
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setIsGeneratingAllAssets(true);
        try {
          const response = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                locations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      description: { type: Type.STRING },
                      prompt: { type: Type.STRING },
                      tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["name", "description", "prompt", "tags"]
                  }
                },
                props: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      description: { type: Type.STRING },
                      prompt: { type: Type.STRING },
                      tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["name", "description", "prompt", "tags"]
                  }
                }
              },
              required: ["locations", "props"]
            }
          });

          const result = safeParseAIResponse(response, { locations: [], props: [] });
          const newAssets: Asset[] = [
            ...(result.locations || []).map((l: any) => ({ ...l, id: `loc-${Date.now()}-${Math.random()}`, type: ASSET_TYPES.LOCATION })),
            ...(result.props || []).map((p: any) => ({ ...p, id: `prop-${Date.now()}-${Math.random()}`, type: ASSET_TYPES.PROP }))
          ];

          const currentAssets = latestProject.assets || [];
          const uniqueNewAssets = deduplicateAssets(currentAssets, newAssets);
          
          if (uniqueNewAssets.length === 0 && newAssets.length > 0) {
            toast.error("生成的场景与道具已全部存在于项目中");
            return;
          }

          updateProject({ assets: [...currentAssets, ...uniqueNewAssets] });
          toast.success(`成功生成 ${uniqueNewAssets.length} 个新资产！`);
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("生成失败，请重试");
        } finally {
          setIsGeneratingAllAssets(false);
        }
      }
    });
  };

  const handleCompressGoldenRules = () => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject || !latestProject.worldBuildingRules || latestProject.worldBuildingRules.length === 0) {
      toast.error('当前没有世界观规则可以提炼。');
      return;
    }

    const rulesContent = latestProject.worldBuildingRules.map((r: any) => `- ${r.category}: ${r.content}`).join('\\n');
    const { options: contextOptions, defaultIds: defaultSelectedContextIds } = gatherContextOptions(latestProject, "compressGoldenRules");

    setPromptModalState({
      isOpen: true,
      templateId: 'compressGoldenRules',
      variables: {
        rulesContent
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setIsGeneratingBible(true);
        const toastId = toast.loading("正在高压提炼三大铁律...");
        try {
          const responseText = await generateAIContent({
            prompt: finalPrompt,
            requireJson: false,
          });

          if (responseText) {
              const ruleLines = responseText.split('\\n').filter(l => l.trim().length > 0);
              const newRules = ruleLines.map(l => ({
                  id: crypto.randomUUID(),
                  category: "黄金铁律 (Golden Rule)",
                  content: l.replace(/^\\d+\\.\\s*|-|\\*/, '').trim()
              })).filter(r => r.content.length > 0);

              // Replace existing rules with the compressed ones
              if (newRules.length > 0) {
                  updateProject({ worldBuildingRules: newRules });
                  toast.success("已提炼出核心铁律！", { id: toastId });
              } else {
                  toast.error("未能成功提取铁律，请重试。", { id: toastId });
              }
          }
        } catch (error) {
          logBibleAIError("Failed to compress rules:", error);
          toast.error("提炼失败，请重试。", { id: toastId });
        } finally {
          setIsGeneratingBible(false);
        }
      }
    });
  };

  const handleGenerateWorldRules = () => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject || isGeneratingWorldRules) return;
    
    const { options: contextOptions, defaultIds } = gatherContextOptions(latestProject, "generateWorldRules");
    const defaultSelectedContextIds = defaultIds.filter((id) => id !== "ctx_inspiration");

    setPromptModalState({
      isOpen: true,
      templateId: 'generateWorldRules',
      variables: {
        inspirationContext: getInspirationContext(latestProject),
        type: getProjectTypeLabel(latestProject.type),
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setIsGeneratingWorldRules(true);
        try {
          const response = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                rules: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      category: { type: Type.STRING },
                      content: { type: Type.STRING },
                    },
                    required: ["category", "content"]
                  }
                }
              },
              required: ["rules"]
            }
          });

          const result = safeParseAIResponse(response, { rules: [] });
          if (result.rules && Array.isArray(result.rules)) {
            const rulesWithIds = result.rules.map((r: any) => ({
              ...r,
              id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
            }));
            const currentRules = useProjectStore.getState().currentProject?.worldBuildingRules || [];
            updateProject({ worldBuildingRules: [...currentRules, ...rulesWithIds] });
            toast.success("世界观规则生成成功！");
          }
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("生成失败，请重试");
        } finally {
          setIsGeneratingWorldRules(false);
        }
      }
    });
  };

  const handleRegenerateAsset = (assetId: string, currentName: string, type: "location" | "prop") => {
    if (!currentProject) return;

    const { options: contextOptions, defaultIds } = gatherContextOptions(currentProject, "regenerateAsset");
    const defaultSelectedContextIds = defaultIds.filter((id) => [
      `ctx_asset_${assetId}`,
      "ctx_logline",
      "ctx_coreConflict",
      "ctx_worldRules",
    ].includes(id));

    setPromptModalState({
      isOpen: true,
      templateId: 'regenerateAsset',
      variables: {
        inspirationContext: getInspirationContext(currentProject || (currentProject)),
        assetName: currentName ? `${type === 'location' ? '场景' : '道具'}名：${currentName}` : '',
        type: getProjectTypeLabel(currentProject.type),
        creativeVision: formatVisualCreativeVision(currentProject.creativeVision),
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        setGeneratingAssetId(assetId);
        try {
          const response = await generateAIContent({
            prompt: finalPrompt,
            requireJson: true,
            schema: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["name", "description", "tags"]
            }
          });
          const result = safeParseAIResponse(response, {
            name: "",
            description: "",
            tags: [],
          });
          
          const latestProject = useProjectStore.getState().currentProject;
          if (!latestProject) return;

          const newAssets = latestProject.assets.map(a => {
            if (a.id === assetId) {
              return {
                ...a,
                name: result.name || a.name,
                description: result.description || a.description,
                tags: result.tags || a.tags,
              };
            }
            return a;
          });
          updateProject({ assets: newAssets });
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          toast.error("生成失败，请重试");
        } finally {
          setGeneratingAssetId(null);
        }
      }
    });
  };

  const handleGenerateCharacterImage = async (charId: string) => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;
    const char = latestProject.characters.find(c => c.id === charId);
    if (!char) return;
    const projectRequest = captureBibleAIProjectRequest(latestProject.id);

    const initialPrompt = buildAssetImagePrompt({
      assetType: "character",
      assetName: char.name,
      description: char.visualIdentity,
      visualStyle: resolveCreativeVisionVisualFallback(latestProject),
    });

    setImagePromptModalState({
      isOpen: true,
      projectId: projectRequest.projectId,
      initialPrompt,
      title: '生成角色参考候选',
      confirmText: '生成图片',
      onConfirm: async (finalPrompt, referenceImage) => {
        if (!isBibleAIProjectRequestCurrent(projectRequest)) return;
        setGeneratingCharImageId(charId);
        try {
          const sourceContentHash = visualImageCandidateSourceContentHash({
            owner: char,
            kind: "base",
            visualStyleLock: latestProject.visualStyleLock,
          });
          let compiledRequest: CompiledImageGenerationRequest | undefined;
          const imageUrl = await generateAIImage({
            promptCore: finalPrompt,
            aspectRatio: "3:4",
            visualStyleProjection: buildBibleAssetVisualStyleProjection({
              project: latestProject,
              asset: char,
              assetType: "character",
            }),
            visualRecipeInputEvidence: buildBibleAssetRecipeEvidence({ asset: char }),
            references: referenceImage ? [createImageGenerationReference({
              imageUrl: referenceImage,
              label: `${char.name} 的角色身份参考`,
              role: "character_identity",
            })] : undefined,
            onPromptCompiled: (compiled) => {
              compiledRequest = compiled;
            },
          });

          if (imageUrl) {
            const staged = await stageVisualImageCandidate({
              ...projectRequest,
              assetId: charId,
              isCharacter: true,
              kind: "base",
              imageUrl,
              prompt: finalPrompt,
              compiledRequest,
              sourceContentHash,
            });
            if (staged) toast.success(`${char.name} 的图片候选已生成，请预览后人工采用`);
          }
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          if (isBibleAIProjectRequestCurrent(projectRequest)) toast.error("图片生成失败，请重试");
        } finally {
          if (isBibleAIProjectRequestCurrent(projectRequest)) setGeneratingCharImageId(null);
        }
      }
    });
  };

  const handleGenerateAssetImage = async (assetId: string) => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;
    const asset = latestProject.assets.find(a => a.id === assetId);
    if (!asset) return;
    const projectRequest = captureBibleAIProjectRequest(latestProject.id);

    const initialPrompt = buildAssetImagePrompt({
      assetType: asset.type === "location" ? "location" : "prop",
      assetName: asset.name,
      description: asset.prompt || asset.description,
      visualStyle: resolveCreativeVisionVisualFallback(latestProject),
    });

    setImagePromptModalState({
      isOpen: true,
      projectId: projectRequest.projectId,
      initialPrompt,
      title: '生成资产参考候选',
      confirmText: '生成图片',
      onConfirm: async (finalPrompt, referenceImage) => {
        if (!isBibleAIProjectRequestCurrent(projectRequest)) return;
        setGeneratingAssetImageId(assetId);
        try {
          const sourceContentHash = visualImageCandidateSourceContentHash({
            owner: asset,
            kind: "base",
            visualStyleLock: latestProject.visualStyleLock,
          });
          let compiledRequest: CompiledImageGenerationRequest | undefined;
          const imageUrl = await generateAIImage({
            promptCore: finalPrompt,
            aspectRatio: asset.type === 'location' ? "16:9" : "1:1",
            visualStyleProjection: buildBibleAssetVisualStyleProjection({
              project: latestProject,
              asset,
              assetType: asset.type === "location" ? "location" : asset.type === "vfx" ? "vfx" : "prop",
            }),
            visualRecipeInputEvidence: buildBibleAssetRecipeEvidence({ asset }),
            references: referenceImage ? [createImageGenerationReference({
              imageUrl: referenceImage,
              label: `${asset.name} 的${asset.type === "location" ? "场景设计" : "道具设计"}参考`,
              role: asset.type === "location" ? "location_design" : "prop_design",
            })] : undefined,
            onPromptCompiled: (compiled) => {
              compiledRequest = compiled;
            },
          });

          if (imageUrl) {
            const staged = await stageVisualImageCandidate({
              ...projectRequest,
              assetId,
              isCharacter: false,
              kind: "base",
              imageUrl,
              prompt: finalPrompt,
              compiledRequest,
              sourceContentHash,
            });
            if (staged) toast.success(`${asset.name} 的图片候选已生成，请预览后人工采用`);
          }
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          if (isBibleAIProjectRequestCurrent(projectRequest)) toast.error("图片生成失败，请重试");
        } finally {
          if (isBibleAIProjectRequestCurrent(projectRequest)) setGeneratingAssetImageId(null);
        }
      }
    });
  };

  const handleGeneratePanoramaImage = async (assetId: string) => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;
    const asset = latestProject.assets.find(a => a.id === assetId);
    if (!asset) return;
    toast.error(`“${asset.name}”需要 2:1 Equirectangular 输出；当前图片供应商合同未声明该画幅，已在提交前阻断。`);
  };

  const handleGenerateVariantImage = async (
    assetId: string,
    variantId: string,
    assetType: 'character' | 'location' | 'prop'
  ) => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;

    let targetAsset: any = null;
    if (assetType === 'character') {
      targetAsset = latestProject.characters.find(c => c.id === assetId);
    } else {
      targetAsset = latestProject.assets.find(a => a.id === assetId);
    }

    if (!targetAsset) return;

    const variant = targetAsset.variants?.find((v: any) => v.id === variantId);
    if (!variant) return;
    const projectRequest = captureBibleAIProjectRequest(latestProject.id);

    const initialPrompt = buildAssetImagePrompt({
      assetType,
      assetName: targetAsset.name,
      description: assetType === "character" ? targetAsset.visualIdentity : targetAsset.description,
      variantDescription: [variant.name, variant.description].filter(Boolean).join("："),
      variantModifiers: variant.promptModifiers,
      visualStyle: resolveCreativeVisionVisualFallback(latestProject),
    });

    setImagePromptModalState({
      isOpen: true,
      projectId: projectRequest.projectId,
      initialPrompt,
      title: '生成变体图',
      confirmText: '生成图片',
      onConfirm: async (finalPrompt, referenceImage) => {
        if (!isBibleAIProjectRequestCurrent(projectRequest)) return;
        setGeneratingCharImageId(`${assetId}-${variantId}`);
        try {
          const sourceContentHash = visualImageCandidateSourceContentHash({
            owner: targetAsset,
            kind: "variant",
            variantId,
            visualStyleLock: latestProject.visualStyleLock,
          });
          let compiledRequest: CompiledImageGenerationRequest | undefined;
          const imageUrl = await generateAIImage({
            promptCore: finalPrompt,
            aspectRatio: assetType === 'character' ? "3:4" : assetType === 'location' ? "16:9" : "1:1",
            visualStyleProjection: buildBibleAssetVisualStyleProjection({
              project: latestProject,
              asset: targetAsset,
              assetType,
              variantId,
            }),
            visualRecipeInputEvidence: buildBibleAssetRecipeEvidence({ asset: targetAsset, variantId }),
            references: referenceImage ? [createImageGenerationReference({
              imageUrl: referenceImage,
              label: assetType === "character"
                ? `${targetAsset.name} 的角色身份参考`
                : `${variant.name || "资产变体"} 的来源参考`,
              role: assetType === "character" ? "character_identity" : assetType === "location" ? "location_design" : "prop_design",
              ...(assetType === "character" ? {
                preserve: ["可识别的脸型、五官比例、发型和人物身份"],
                allowChange: ["按当前变体描述改变服装、配饰、姿态、表情和光照"],
                exclude: ["参考图背景、文字、排版和未被当前变体要求的新增人物"],
              } : {}),
            })] : undefined,
            onPromptCompiled: (compiled) => {
              compiledRequest = compiled;
            },
          });

          if (imageUrl) {
            const staged = await stageVisualImageCandidate({
              ...projectRequest,
              assetId,
              isCharacter: assetType === "character",
              kind: "variant",
              variantId,
              imageUrl,
              prompt: finalPrompt,
              compiledRequest,
              sourceContentHash,
            });
            if (staged) toast.success("变体图片候选已生成，请预览后人工采用");
          }
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          if (isBibleAIProjectRequestCurrent(projectRequest)) toast.error('变体图像生成失败');
        } finally {
          if (isBibleAIProjectRequestCurrent(projectRequest)) setGeneratingCharImageId(null);
        }
      }
    });
  };

  const handleGenerateSpecificPrompt = async (
    type: 'character_multiview' | 'prop_multiview' | 'location_panorama',
    id: string
  ) => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;
    const projectRequest = captureBibleAIProjectRequest(latestProject.id);

    let targetName = '';
    let targetDesc = '';
    let templateId = 'generateSpecificPrompt';

    if (type === 'character_multiview') {
      const char = latestProject.characters.find(c => c.id === id);
      if (!char) return;
      targetName = char.name;
      targetDesc = char.visualIdentity || char.name;
      templateId = 'generateCharacterMultiViewPrompt';
    } else if (type === 'prop_multiview') {
      const asset = latestProject.assets.find(a => a.id === id);
      if (!asset) return;
      targetName = asset.name;
      targetDesc = asset.description || '';
      templateId = 'generatePropMultiViewPrompt';
    } else if (type === 'location_panorama') {
      const asset = latestProject.assets.find(a => a.id === id);
      if (!asset) return;
      targetName = asset.name;
      targetDesc = asset.description || '';
      templateId = 'generatePanoramaPrompt';
    }

    const { options: contextOptions, defaultIds: defaultSelectedContextIds } = gatherContextOptions(latestProject, templateId);

    setPromptModalState({
      isOpen: true,
      projectId: projectRequest.projectId,
      templateId,
      variables: {
        targetName,
        targetDesc,
        visualStyle: latestProject.creativeVision?.visualStyle || ''
      },
      contextOptions,
      defaultSelectedContextIds,
      onConfirm: async (finalPrompt) => {
        if (!isBibleAIProjectRequestCurrent(projectRequest)) return;
        setIsOptimizingPrompt(true);
        try {
          const response = await generateAIContent({
            prompt: finalPrompt,
            requireJson: false
          });
          
          const generatedPrompt = response.trim();
          
          const latestProj = useProjectStore.getState().currentProject;
          if (!latestProj || !isBibleAIProjectRequestCurrent(projectRequest)) return;

          if (type === 'character_multiview') {
            if (!latestProj.characters.some((character) => character.id === id)) return;
            const newChars = latestProj.characters.map(c => 
              c.id === id ? { ...c, multiViewPrompt: generatedPrompt } : c
            );
            await updateProject({ characters: newChars });
          } else {
            if (!latestProj.assets.some((asset) => asset.id === id)) return;
            const newAssets = latestProj.assets.map(a => {
              if (a.id === id) {
                if (type === 'prop_multiview') return { ...a, multiViewPrompt: generatedPrompt };
                if (type === 'location_panorama') return { ...a, panoramaPrompt: generatedPrompt };
              }
              return a;
            });
            await updateProject({ assets: newAssets });
          }
          if (isBibleAIProjectRequestCurrent(projectRequest)) toast.success('提示词已优化并更新');
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          if (isBibleAIProjectRequestCurrent(projectRequest)) toast.error('提示词生成失败');
        } finally {
          if (isBibleAIProjectRequestCurrent(projectRequest)) setIsOptimizingPrompt(false);
        }
      }
    });
  };

  const handleGenerateCharMultiViewImage = async (charId: string) => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;
    const char = latestProject.characters.find(c => c.id === charId);
    if (!char) return;
    const projectRequest = captureBibleAIProjectRequest(latestProject.id);

    const initialPrompt = char.multiViewPrompt || buildMultiViewImagePrompt({
      assetType: "character",
      assetName: char.name,
      description: char.visualIdentity,
      visualStyle: resolveCreativeVisionVisualFallback(latestProject),
    });

    setImagePromptModalState({
      isOpen: true,
      projectId: projectRequest.projectId,
      initialPrompt,
      title: '生成多视图设计图',
      confirmText: '生成图片',
      onConfirm: async (finalPrompt, referenceImage) => {
        if (!isBibleAIProjectRequestCurrent(projectRequest)) return;
        setGeneratingCharImageId(charId);
        try {
          const currentProjectForPrompt = useProjectStore.getState().currentProject;
          if (!currentProjectForPrompt || !isBibleAIProjectRequestCurrent(projectRequest)) return;
          const sourceOwner = currentProjectForPrompt.characters.find((character) => character.id === charId);
          if (!sourceOwner) return;
          const generationOwner = { ...sourceOwner, multiViewPrompt: finalPrompt };
          const newChars = currentProjectForPrompt.characters.map(c =>
            c.id === charId ? { ...c, multiViewPrompt: finalPrompt } : c
          );
          await updateProject({ characters: newChars });
          if (!isBibleAIProjectRequestCurrent(projectRequest)) return;

          const sourceContentHash = visualImageCandidateSourceContentHash({
            owner: generationOwner,
            kind: "multiview",
            visualStyleLock: currentProjectForPrompt.visualStyleLock,
          });
          let compiledRequest: CompiledImageGenerationRequest | undefined;
          const imageUrl = await generateAIImage({
            promptCore: finalPrompt,
            aspectRatio: "16:9",
            visualStyleProjection: buildBibleAssetVisualStyleProjection({
              project: currentProjectForPrompt,
              asset: generationOwner,
              assetType: "character",
            }),
            visualRecipeInputEvidence: buildBibleAssetRecipeEvidence({ asset: generationOwner }),
            references: referenceImage ? [createImageGenerationReference({
              imageUrl: referenceImage,
              label: `${char.name} 的角色身份参考`,
              role: "character_identity",
            })] : undefined,
            onPromptCompiled: (compiled) => {
              compiledRequest = compiled;
            },
          });

          if (imageUrl) {
            const staged = await stageVisualImageCandidate({
              ...projectRequest,
              assetId: charId,
              isCharacter: true,
              kind: "multiview",
              imageUrl,
              prompt: finalPrompt,
              compiledRequest,
              sourceContentHash,
            });
            if (staged) toast.success(`${char.name} 的多视图候选已生成，请预览后人工采用`);
          }
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          if (isBibleAIProjectRequestCurrent(projectRequest)) toast.error("多视图生成失败，请重试");
        } finally {
          if (isBibleAIProjectRequestCurrent(projectRequest)) setGeneratingCharImageId(null);
        }
      }
    });
  };

  const handleGenerateAssetMultiViewImage = async (assetId: string) => {
    const latestProject = useProjectStore.getState().currentProject;
    if (!latestProject) return;
    const asset = latestProject.assets.find(a => a.id === assetId);
    if (!asset) return;
    const projectRequest = captureBibleAIProjectRequest(latestProject.id);

    const initialPrompt = asset.multiViewPrompt || buildMultiViewImagePrompt({
      assetType: asset.type === "location" ? "location" : "prop",
      assetName: asset.name,
      description: asset.prompt || asset.description,
      visualStyle: resolveCreativeVisionVisualFallback(latestProject),
    });

    setImagePromptModalState({
      isOpen: true,
      projectId: projectRequest.projectId,
      initialPrompt,
      title: '生成多视图设计图',
      confirmText: '生成图片',
      onConfirm: async (finalPrompt, referenceImage) => {
        if (!isBibleAIProjectRequestCurrent(projectRequest)) return;
        setGeneratingAssetImageId(assetId);
        try {
          const currentProjectForPrompt = useProjectStore.getState().currentProject;
          if (!currentProjectForPrompt || !isBibleAIProjectRequestCurrent(projectRequest)) return;
          const sourceOwner = currentProjectForPrompt.assets.find((entry) => entry.id === assetId);
          if (!sourceOwner) return;
          const generationOwner = { ...sourceOwner, multiViewPrompt: finalPrompt };
          const newAssets = currentProjectForPrompt.assets.map(a =>
            a.id === assetId ? { ...a, multiViewPrompt: finalPrompt } : a
          );
          await updateProject({ assets: newAssets });
          if (!isBibleAIProjectRequestCurrent(projectRequest)) return;

          const sourceContentHash = visualImageCandidateSourceContentHash({
            owner: generationOwner,
            kind: "multiview",
            visualStyleLock: currentProjectForPrompt.visualStyleLock,
          });
          let compiledRequest: CompiledImageGenerationRequest | undefined;
          const imageUrl = await generateAIImage({
            promptCore: finalPrompt,
            aspectRatio: "16:9",
            visualStyleProjection: buildBibleAssetVisualStyleProjection({
              project: currentProjectForPrompt,
              asset: generationOwner,
              assetType: generationOwner.type === "location" ? "location" : generationOwner.type === "vfx" ? "vfx" : "prop",
            }),
            visualRecipeInputEvidence: buildBibleAssetRecipeEvidence({ asset: generationOwner }),
            references: referenceImage ? [createImageGenerationReference({
              imageUrl: referenceImage,
              label: `${asset.name} 的${asset.type === "location" ? "场景设计" : "道具设计"}参考`,
              role: asset.type === "location" ? "location_design" : "prop_design",
            })] : undefined,
            onPromptCompiled: (compiled) => {
              compiledRequest = compiled;
            },
          });

          if (imageUrl) {
            const staged = await stageVisualImageCandidate({
              ...projectRequest,
              assetId,
              isCharacter: false,
              kind: "multiview",
              imageUrl,
              prompt: finalPrompt,
              compiledRequest,
              sourceContentHash,
            });
            if (staged) toast.success(`${asset.name} 的多视图候选已生成，请预览后人工采用`);
          }
        } catch (error) {
          logBibleAIError("Bible AI generation failed:", error);
          if (isBibleAIProjectRequestCurrent(projectRequest)) toast.error("多视图生成失败，请重试");
        } finally {
          if (isBibleAIProjectRequestCurrent(projectRequest)) setGeneratingAssetImageId(null);
        }
      }
    });
  };

  const visiblePromptModalState = promptModalState.projectId
    && promptModalState.projectId !== renderedProjectId
    ? { ...promptModalState, isOpen: false }
    : promptModalState;
  const visibleImagePromptModalState = imagePromptModalState.projectId === renderedProjectId
    ? imagePromptModalState
    : { ...imagePromptModalState, isOpen: false };

  return {
    isGeneratingLogline,
    isGeneratingConflict,
    isGeneratingCharacters,
    isGeneratingArc,
    isGeneratingAllAssets,
    isGeneratingWorldRules,
    generatingCharId,
    generatingAssetId,
    generatingCharImageId,
    generatingAssetImageId,
    isOptimizingPrompt,
    promptModalState: visiblePromptModalState,
    closePromptModal,
    imagePromptModalState: visibleImagePromptModalState,
    closeImagePromptModal,
    characterValidationReport,
    setCharacterValidationReport,
    handleApplyCharacterRefinement,
    handleRegenerateLogline,
    handleRegenerateConflict,
    handleRegenerateArc,
    handlePlanCharacterRoster,
    handleGenerateCharacters,
    handleValidateAndRefineCharacters,
    handleRegenerateCharacter,
    handleEstimateAssetCount,
    handlePlanLocationRoster,
    handlePlanPropRoster,
    handleGenerateLocations,
    handleGenerateProps,
    handleGenerateAllAssets,
    handleCompressGoldenRules,
    handleGenerateWorldRules,
    handleRegenerateAsset,
    handleGenerateCharacterImage,
    handleGenerateAssetImage,
    handleGeneratePanoramaImage,
    handleGenerateSpecificPrompt,
    handleGenerateCharMultiViewImage,
    handleGenerateAssetMultiViewImage,
    handleGenerateVariantImage,
  };
}
