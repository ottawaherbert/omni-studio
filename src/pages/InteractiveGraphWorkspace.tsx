import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { APP_BEFORE_NAVIGATE_EVENT } from '../utils/navigationGuard';
import { Sparkles, Plus, Wand2, Loader2, FileText } from 'lucide-react';

import {
  interactiveClient,
  type GraphLayoutRevision,
  type InteractiveExperienceAggregate,
  type InteractionFormatProfile,
  type InteractiveAuthoringStatusProjection,
  type InteractiveChoice,
  type NarrativeGraphVersion,
  type NarrativeNode,
  type NodeCapability,
  type NodeContentBinding,
  type StateSchema,
  type StoryArchitecture,
  type StorySourceBinding,
} from '../clients/interactiveProductionClient';
import { interactiveAuthoringClient } from '../clients/interactiveAuthoringClient';
import { auditNarrativeGraph } from '../domains/interactive/qa/graphQAEngine';
import { durationBudgetForFormat } from '../domains/interactive/durationContract';
import { InteractiveGraphDraft } from '../domains/interactive/authoring/graphDraft';
import {
  artifactRefIdentity,
  bindingScriptSceneRefs,
} from '../domains/interactive/binding/nodeContentBinding';
import type { InteractiveContentPlanDraft } from '../domains/interactive/contentPlanning/contentPlan';
import type { InteractiveWritingSceneOption } from '../domains/interactive/ports/writingPort';
import type { InteractiveMediaPlanDraft, InteractiveProductionPlanDraft } from '../clients/domainTypes';
import InteractiveGraphCanvas from '../components/interactive/InteractiveGraphCanvas';

// Whiteboard components
import { InteractiveWhiteboardHeader } from '../components/interactive/whiteboard/InteractiveWhiteboardHeader';
import { InteractiveCanvasToolbar } from '../components/interactive/whiteboard/InteractiveCanvasToolbar';
import type { AiActionType } from '../components/interactive/whiteboard/InteractiveAiDrawer';
import { InteractivePathDrawer } from '../components/interactive/whiteboard/InteractivePathDrawer';
import { InteractiveStoryUnitSwitcher } from '../components/interactive/whiteboard/InteractiveStoryUnitSwitcher';
import { createGraphLayoutSaveCoordinator } from '../features/interactive/graphLayoutSaveCoordinator';
import type { InteractiveProjectSettingsValue } from '../components/interactive/whiteboard/InteractiveProjectSettingsInspector';
import type { ContentMappingChange } from '../components/interactive/InteractiveContentMappingModal';
import { buildInteractiveStoryUnits, storyPlacementForNode } from '../domains/interactive/structure/storyUnits.ts';
import { creatorFacingInteractiveAiError } from '../features/interactive/creatorFacingAiError.ts';
import {
  hasNodeCapability,
  nodeCapabilities,
  nodeRequiresMainContent,
} from '../domains/interactive/nodeContentRequirements.ts';

const InteractiveProjectSettingsInspector = lazy(() => import('../components/interactive/whiteboard/InteractiveProjectSettingsInspector').then((module) => ({ default: module.InteractiveProjectSettingsInspector })));
const InteractiveStateSchemaInspector = lazy(() => import('../components/interactive/whiteboard/InteractiveStateSchemaInspector').then((module) => ({ default: module.InteractiveStateSchemaInspector })));
const InteractiveNodeInspector = lazy(() => import('../components/interactive/whiteboard/InteractiveNodeInspector')
  .then((module) => ({ default: module.InteractiveNodeInspector })));
const InteractiveChoiceInspector = lazy(() => import('../components/interactive/whiteboard/InteractiveChoiceInspector')
  .then((module) => ({ default: module.InteractiveChoiceInspector })));
const InteractiveAiDrawer = lazy(() => import('../components/interactive/whiteboard/InteractiveAiDrawer')
  .then((module) => ({ default: module.InteractiveAiDrawer })));
const InteractiveGraphDraftReview = lazy(() => import('../components/interactive/whiteboard/InteractiveGraphDraftReview')
  .then((module) => ({ default: module.InteractiveGraphDraftReview })));
const InteractiveContentPlanReview = lazy(() => import('../components/interactive/whiteboard/InteractiveContentPlanReview')
  .then((module) => ({ default: module.InteractiveContentPlanReview })));
const InteractiveProductionPlanReview = lazy(() => import('../components/interactive/whiteboard/InteractiveProductionPlanReview')
  .then((module) => ({ default: module.InteractiveProductionPlanReview })));
const InteractiveMediaPlanReview = lazy(() => import('../components/interactive/whiteboard/InteractiveMediaPlanReview')
  .then((module) => ({ default: module.InteractiveMediaPlanReview })));
const PromptEditorModal = lazy(() => import('../components/PromptEditorModal'));
const InteractiveContentMappingModal = lazy(() =>
  import('../components/interactive/InteractiveContentMappingModal')
    .then((module) => ({ default: module.InteractiveContentMappingModal })));

interface InteractivePromptRequest {
  title: string;
  templateId: string;
  variables: Record<string, string>;
  execute: (finalPrompt: string) => Promise<void>;
}

const graphContextForPrompt = (graph: NarrativeGraphVersion | null) => JSON.stringify({
  entryNodeId: graph?.entryNodeId || '',
  nodes: (graph?.nodes || []).map((node) => ({
    id: node.id,
    title: node.brief.title,
    intent: node.brief.intent,
    summary: node.brief.narrativeSummary,
    choices: node.choices.map((choice) => ({
      text: choice.text,
      targetNodeId: choice.targetNodeId,
    })),
  })),
}, null, 2);

const creatorFacingGraphIssue = (issue: string) => {
  if (issue === '图谱入口节点 "" 不存在') return '请先设定入口节点';
  if (issue.includes('图谱缺失有效结局')) return '图谱没有可到达的结局节点，所有路径都会中断';
  return issue
    .replaceAll('结局 StoryBeat', '结局故事支点')
    .replaceAll('Production Block', '制作区段')
    .replaceAll('Ending Contract', '结局合同')
    .replaceAll('StoryBeat', '故事支点')
    .replaceAll('Beat', '故事支点')
    .replaceAll('schema', '故事规则');
};

const lightweightStoryPositions = (graph: NarrativeGraphVersion) => Object.fromEntries(
  graph.nodes.map((node, index) => [
    node.id,
    {
      x: 100 + (index % 4) * 340,
      y: 140 + Math.floor(index / 4) * 230,
    },
  ]),
);

const createNewNode = (index: number): NarrativeNode => {
  const id = `node_${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    brief: {
      nodeId: id,
      title: `节点 ${index + 1}`,
      intent: '填写此节点的戏剧意图',
      dramaticFunction: index === 0 ? 'exposition' : 'choice_point',
      narrativeSummary: '填写剧情概要',
    },
    contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
    choices: [],
    interaction: {
      capabilities: index === 0 ? ['play_content'] : ['play_content', 'present_choice'],
      contentPolicy: 'create_shared_content',
      durationRangeSec: [45, 90],
      playerKnowledgeIn: [],
      playerKnowledgeOut: [],
    },
  };
};

export default function InteractiveGraphWorkspace() {
  const { experienceId = '' } = useParams<{ experienceId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedNodeId = searchParams.get('nodeId');
  const requestedDraftId = searchParams.get('draftId');
  const shouldRetryInitialDraft = searchParams.get('aiRetry') === '1';
  const returnedWritingProjectId = searchParams.get('writingProjectId');

  // Core domain state
  const [experienceTitle, setExperienceTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [formatProfile, setFormatProfile] = useState<InteractionFormatProfile | null>(null);
  const [graph, setGraphState] = useState<NarrativeGraphVersion | null>(null);
  const [stateSchema, setStateSchema] = useState<StateSchema | null>(null);
  const [storyArchitecture, setStoryArchitecture] = useState<StoryArchitecture | null>(null);
  const [layout, setLayout] = useState<GraphLayoutRevision | null>(null);
  const [bindings, setBindings] = useState<NodeContentBinding[]>([]);
  const [storySource, setStorySource] = useState<StorySourceBinding>({ mode: 'scratch' });
  const [authoringStatus, setAuthoringStatus] = useState<InteractiveAuthoringStatusProjection | null>(null);
  const [hasUnsavedChanges, setDirtyState] = useState(false);
  const [recoveryConflict, setRecoveryConflict] = useState<NarrativeGraphVersion | null>(null);
  const [loadedGraphVersion, setLoadedGraphVersion] = useState(0);
  const [loadedServerGraph, setLoadedServerGraph] = useState<NarrativeGraphVersion | null>(null);
  const draftKey = `omni.interactive.graph.draft.${experienceId}`;
  const graphRef = useRef(graph);
  const dirtyRef = useRef(false);
  const graphSaveRef = useRef<Promise<boolean> | null>(null);
  const adoptingRef = useRef(false);
  const metadataRef = useRef<InteractiveExperienceAggregate | null>(null);
  const [settingsValue, setSettingsValue] = useState<InteractiveProjectSettingsValue | null>(null);
  const [settingsPanel, setSettingsPanel] = useState<'project' | 'state' | null>(null);
  const settingsSavingRef = useRef(false);
  const settingsBaselineRef = useRef<InteractiveExperienceAggregate | null>(null);
  const [layoutError, setLayoutError] = useState('');
  const [layoutPending, setLayoutPending] = useState(false);
  const layoutSaver = useRef<ReturnType<typeof createGraphLayoutSaveCoordinator> | null>(null);
  const setGraph = useCallback((next: React.SetStateAction<NarrativeGraphVersion | null>) => {
    const value = typeof next === 'function' ? next(graphRef.current) : next;
    graphRef.current = value;
    setGraphState(value);
  }, []);
  const setHasUnsavedChanges = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    setDirtyState(dirty);
  }, []);
  const updateMetadata = (aggregate: InteractiveExperienceAggregate) => {
    metadataRef.current = aggregate;
    setExperienceTitle(aggregate.experience.title);
    setGenre(aggregate.experience.genre);
    setFormatProfile(aggregate.experience.formatProfile);
    setStateSchema(aggregate.stateSchema.data);
    setStoryArchitecture(aggregate.storyArchitecture.data);
    setSettingsValue({
      title: aggregate.experience.title, genre: aggregate.experience.genre,
      formatProfile: aggregate.experience.formatProfile, productionBoundary: aggregate.experience.productionBoundary,
      experienceSpec: aggregate.experienceSpec.data, storyArchitecture: aggregate.storyArchitecture.data,
    });
  };
  const handleChangeLayout = useCallback((patch: Pick<GraphLayoutRevision, 'nodes' | 'viewport'>) => {
    layoutSaver.current?.update(patch);
  }, []);
  useEffect(() => () => { layoutSaver.current = null; }, []);

  // Active Selections
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedChoiceId, setSelectedChoiceId] = useState('');

  // Overlays & Drawers State
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [isPathDrawerOpen, setIsPathDrawerOpen] = useState(false);
  const [activeDraft, setActiveDraft] = useState<InteractiveGraphDraft | null>(null);
  const [activeContentPlan, setActiveContentPlan] = useState<InteractiveContentPlanDraft | null>(null);
  const [contentPlanCandidate, setContentPlanCandidate] = useState<InteractiveContentPlanDraft | null>(null);
  const [contentPlanScenes, setContentPlanScenes] = useState<InteractiveWritingSceneOption[]>([]);
  const [productionPlanCandidate, setProductionPlanCandidate] = useState<InteractiveProductionPlanDraft | null>(null);
  const [activeProductionPlan, setActiveProductionPlan] = useState<InteractiveProductionPlanDraft | null>(null);
  const [mediaPlanCandidate, setMediaPlanCandidate] = useState<InteractiveMediaPlanDraft | null>(null);
  const [activeMediaPlan, setActiveMediaPlan] = useState<InteractiveMediaPlanDraft | null>(null);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isAdoptingDraft, setIsAdoptingDraft] = useState(false);
  const [isWorkingOnContentPlan, setIsWorkingOnContentPlan] = useState(false);
  const [isWorkingOnProductionPlan, setIsWorkingOnProductionPlan] = useState(false);
  const [preparingContentNodeId, setPreparingContentNodeId] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [promptRequest, setPromptRequest] = useState<InteractivePromptRequest | null>(null);
  const [isContentMappingOpen, setIsContentMappingOpen] = useState(false);
  const [activeStoryUnitId, setActiveStoryUnitId] = useState('');

  // Load experience aggregate & layout
  useEffect(() => {
    if (!experienceId) return;
    let active = true;
    if (graphRef.current?.experienceId !== experienceId) {
      setRecoveryConflict(null);
      setLoadedServerGraph(null);
      setLoadedGraphVersion(0);
      setGraph(null);
      setHasUnsavedChanges(false);
    } else if (hasUnsavedChanges) {
      // A query-only route change must not replace an unsaved local graph.
      return;
    }
    setActiveDraft(null);
    setContentPlanCandidate(null);
    setActiveContentPlan(null);
    setProductionPlanCandidate(null);
    setActiveProductionPlan(null);
    setMediaPlanCandidate(null);
    setActiveMediaPlan(null);
    Promise.all([
      interactiveClient.getWhiteboardExperience(experienceId),
      interactiveClient.getGraphLayout(experienceId),
      requestedDraftId ? interactiveAuthoringClient.getDraft(experienceId, requestedDraftId) : Promise.resolve(null),
      requestedDraftId ? Promise.resolve(null) : interactiveAuthoringClient.getLatestDraft(experienceId),
    ])
      .then(([aggregate, initialLayout, requestedDraft, latestGraphDraft]) => {
        if (!active) return;
        updateMetadata(aggregate);
        let restoredGraph: NarrativeGraphVersion | null = null;
        try {
          const savedDraft = JSON.parse(localStorage.getItem(draftKey) || 'null') as { graph?: NarrativeGraphVersion } | null;
          if (savedDraft?.graph?.experienceId === experienceId) {
            if (savedDraft.graph.versionIndex === aggregate.graph.versionIndex) restoredGraph = savedDraft.graph;
            else setRecoveryConflict(savedDraft.graph);
          }
        } catch { toast.error('本机白板草稿无法读取，请检查浏览器存储'); }
        setGraph({ ...(restoredGraph || aggregate.graph), locked: false });
        setLoadedGraphVersion(aggregate.graph.versionIndex);
        setLoadedServerGraph(aggregate.graph);
        setHasUnsavedChanges(Boolean(restoredGraph));
        if (restoredGraph) toast('已恢复本机未保存的白板修改');
        setStateSchema(aggregate.stateSchema.data);
        setStoryArchitecture(aggregate.storyArchitecture.data);
        setLayout(initialLayout);
        setLayoutError('');
        const saver = createGraphLayoutSaveCoordinator({
          initial: initialLayout,
          persist: (next, version) => interactiveClient.saveGraphLayout(experienceId, next, version),
          onChange: (next) => { if (layoutSaver.current === saver) {
            setLayout(next);
            const pending = layoutSaver.current?.pending || false;
            setLayoutPending(pending);
            if (!pending) setLayoutError('');
          } },
          onError: (error) => {
            if (layoutSaver.current !== saver) return;
            const message = error instanceof Error ? error.message : '画布位置未保存，请重试';
            setLayoutError(message);
            toast.error(message);
          },
        });
        layoutSaver.current = saver;
        setBindings(aggregate.bindings || []);
        setStorySource(aggregate.experience.storySource);
        const recoverableDraft = requestedDraft || latestGraphDraft;
        if (
          recoverableDraft?.status === 'candidate'
          && recoverableDraft.baseGraphVersionId === aggregate.graph.id
        ) setActiveDraft(recoverableDraft);
        if (shouldRetryInitialDraft && aggregate.graph.nodes.length === 0) setIsAiDrawerOpen(true);
        if (requestedNodeId && aggregate.graph.nodes.some((n) => n.id === requestedNodeId)) {
          setSelectedNodeId(requestedNodeId);
        }
      })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : '白板数据加载失败'); });
    return () => { active = false; };
  }, [experienceId, requestedDraftId, shouldRetryInitialDraft]);

  useEffect(() => {
    if (requestedNodeId && graphRef.current?.nodes.some((node) => node.id === requestedNodeId)) setSelectedNodeId(requestedNodeId);
  }, [requestedNodeId, graph?.experienceId]);

  useEffect(() => {
    if (!hasUnsavedChanges || !graph || graph.experienceId !== experienceId) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ graph, savedAt: Date.now() })); }
    catch { toast.error('本机白板草稿保存失败，请先保存图谱'); }
  }, [draftKey, graph, hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges && !layoutPending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const guardProgrammatic = (event: Event) => {
      event.preventDefault();
      toast('请先保存白板，再切换工作区');
    };
    window.addEventListener('beforeunload', warn);
    window.addEventListener(APP_BEFORE_NAVIGATE_EVENT, guardProgrammatic);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener(APP_BEFORE_NAVIGATE_EVENT, guardProgrammatic);
    };
  }, [hasUnsavedChanges, layoutPending]);

  useEffect(() => {
    if (
      !graph
      || graph.nodes.length === 0
      || graph.nodes.every((node) => Boolean(layout?.nodes[node.id]))
    ) return;
    let cancelled = false;
    void import('../domains/interactive/layout/graphAutoLayout').then(({ buildStoryFlowPositions }) => {
      if (cancelled) return;
      handleChangeLayout({ nodes: { ...buildStoryFlowPositions(graph), ...(layoutSaver.current?.current.nodes || {}) } });
    }).catch(() => {
      if (!cancelled) toast.error('画布布局加载失败，请点击重新排列');
    });
    return () => {
      cancelled = true;
    };
  }, [experienceId, graph, layout]);

  useEffect(() => {
    if (!experienceId || !returnedWritingProjectId || graph?.experienceId !== experienceId) return;
    const clearReturnedProject = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('writingProjectId');
      const query = next.toString();
      navigate(`/interactive/experiences/${encodeURIComponent(experienceId)}/graph${query ? `?${query}` : ''}`, { replace: true });
    };
    if (storySource.writingProjectId === returnedWritingProjectId) {
      clearReturnedProject();
      return;
    }
    interactiveClient.saveStorySource(experienceId, {
      mode: 'bind_writing',
      writingProjectId: returnedWritingProjectId,
    }).then((aggregate) => {
      updateMetadata(aggregate);
      setStorySource(aggregate.experience.storySource);
      setBindings(aggregate.bindings || []);
      clearReturnedProject();
      toast.success('剧本已连接到当前互动项目');
    }).catch((error) => toast.error(error instanceof Error ? error.message : '无法连接返回的剧本'));
  }, [experienceId, graph?.experienceId, navigate, returnedWritingProjectId, searchParams, storySource.writingProjectId]);

  useEffect(() => {
    const writingProjectId = storySource.writingProjectId;
    if (!writingProjectId) {
      setAuthoringStatus(null);
      return;
    }
    let active = true;
    let timer: number | undefined;
    const refreshStatus = () => {
      interactiveClient.getAuthoringStatus(experienceId)
        .then((status) => {
          if (!active) return;
          setAuthoringStatus(status);
          if (status.content.state === 'review') {
            void interactiveClient.getLatestContentPlan(experienceId).then((plan) => {
              if (active && plan?.status === 'candidate') setContentPlanCandidate(plan);
            });
          }
          if (
            status.writing.state === 'working'
            || status.content.state === 'waiting'
            || status.content.state === 'working'
          ) {
            timer = window.setTimeout(refreshStatus, 3_000);
          }
        })
        .catch(() => {
        });
    };
    refreshStatus();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [experienceId, storySource.writingProjectId]);

  const refreshAuthoringStatus = async () => {
    const status = await interactiveClient.getAuthoringStatus(experienceId);
    setAuthoringStatus(status);
    return status;
  };

  useEffect(() => {
    if (!storySource.writingProjectId) {
      setContentPlanScenes([]);
      return;
    }
    interactiveClient.listWritingSceneSummaries(experienceId)
      .then(setContentPlanScenes)
      .catch(() => setContentPlanScenes([]));
  }, [experienceId, storySource.writingProjectId]);

  // Structural QA audit
  const durationBudget = useMemo(
    () => durationBudgetForFormat(storyArchitecture?.durationBudget, formatProfile || undefined),
    [formatProfile, storyArchitecture?.durationBudget],
  );
  const qaResult = useMemo(
    () => (graph && stateSchema ? auditNarrativeGraph(graph, stateSchema, durationBudget) : null),
    [durationBudget, graph, stateSchema]
  );
  const storyUnits = useMemo(
    () => buildInteractiveStoryUnits(storyArchitecture, graph).map((unit) => {
      const sceneIdentities = new Set(
        bindings
          .filter((binding) => unit.nodeIds.includes(binding.nodeId) && binding.slot === 'main')
          .flatMap((binding) => bindingScriptSceneRefs(binding))
          .map((ref) => `${ref.artifactId}:${ref.versionId}:${ref.checksum}`),
      );
      return { ...unit, scriptSceneCount: sceneIdentities.size };
    }),
    [bindings, graph, storyArchitecture],
  );
  const nodeDurationSeconds = useMemo(() => {
    const secondsBySceneRef = new Map(
      contentPlanScenes.map((scene) => [
        artifactRefIdentity(scene.ref),
        Math.max(0, Number(scene.targetDurationSeconds || 0)),
      ]),
    );
    return Object.fromEntries(bindings
      .filter((binding) => binding.slot === 'main' && binding.status === 'approved')
      .map((binding) => [
        binding.nodeId,
        bindingScriptSceneRefs(binding).reduce(
          (total, ref) => total + (secondsBySceneRef.get(artifactRefIdentity(ref)) || 0),
          0,
        ),
      ])
      .filter(([, seconds]) => Number(seconds) > 0));
  }, [bindings, contentPlanScenes]);
  const mappedScreenplayNodeCount = useMemo(() => {
    const requiredNodeIds = new Set(
      (graph?.nodes || []).filter(nodeRequiresMainContent).map((node) => node.id),
    );
    return new Set(
      bindings
        .filter((binding) => (
          binding.slot === 'main'
          && binding.status === 'approved'
          && requiredNodeIds.has(binding.nodeId)
          && bindingScriptSceneRefs(binding).length > 0
        ))
        .map((binding) => binding.nodeId),
    ).size;
  }, [bindings, graph?.nodes]);
  const activeStoryUnit = storyUnits.find((unit) => unit.id === activeStoryUnitId)
    || storyUnits[0]
    || null;
  const visibleNodeIds = activeStoryUnit?.nodeIds;

  useEffect(() => {
    if (!storyUnits.length) {
      setActiveStoryUnitId('');
      return;
    }
    if (!storyUnits.some((unit) => unit.id === activeStoryUnitId)) {
      setActiveStoryUnitId(storyUnits[0].id);
    }
  }, [activeStoryUnitId, storyUnits]);

  useEffect(() => {
    if (!activeStoryUnit || !selectedNodeId || activeStoryUnit.nodeIds.includes(selectedNodeId)) return;
    setSelectedNodeId('');
    setSelectedChoiceId('');
  }, [activeStoryUnit, selectedNodeId]);

  const selectedNode = useMemo(
    () => (graph && selectedNodeId ? graph.nodes.find((n) => n.id === selectedNodeId) : null),
    [graph, selectedNodeId]
  );

  const selectedChoice = useMemo(() => {
    if (!graph || !selectedChoiceId) return null;
    const fromTransitions = (graph.transitions || []).find((t) => t.id === selectedChoiceId);
    if (fromTransitions) return fromTransitions;
    for (const node of graph.nodes) {
      const found = node.choices.find((c) => c.id === selectedChoiceId);
      if (found) return found;
    }
    return null;
  }, [graph, selectedChoiceId]);

  const isEmptyGraph = !graph || graph.nodes.length === 0;

  // Handle Save Graph Revision
  const savePendingGraph = async (): Promise<boolean> => {
    if (graphSaveRef.current) return graphSaveRef.current;
    const pending = graphRef.current;
    if (!pending || !experienceId || !dirtyRef.current) return true;
    if (pending.experienceId !== experienceId || adoptingRef.current) return false;
    const save = (async () => {
      try {
        const res = await interactiveClient.saveGraph(experienceId, pending, 'draft', pending.versionIndex);
        const unchanged = graphRef.current === pending;
        setGraph(unchanged ? { ...res.graph, locked: false }
          : (current) => current ? { ...current, versionIndex: res.graph.versionIndex, id: res.graph.id } : current);
        updateMetadata(res);
        setBindings(res.bindings);
        if (unchanged) {
          setHasUnsavedChanges(false);
          try { localStorage.removeItem(draftKey); } catch { /* Already persisted remotely. */ }
        } else toast('保存期间又有新修改，请再次保存后继续');
        return unchanged;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '保存图谱失败');
        return false;
      }
    })();
    graphSaveRef.current = save;
    try { return await save; } finally { graphSaveRef.current = null; }
  };
  const flushLayout = async () => {
    try { await layoutSaver.current?.flush(); return true; } catch { return false; }
  };
  const handleSaveGraph = async () => {
    if (await savePendingGraph() && await flushLayout()) toast.success('白板已保存');
  };
  const leaveWhiteboard = async (target: string) => {
    if (adoptingRef.current || !(await savePendingGraph()) || !(await flushLayout())) return;
    navigate(target);
  };
  const handleSaveSettings = async (next: InteractiveProjectSettingsValue) => {
    if (settingsSavingRef.current || adoptingRef.current || !metadataRef.current) return;
    const baseline = settingsBaselineRef.current || metadataRef.current;
    if (!(await savePendingGraph())) return;
    settingsSavingRef.current = true;
    try {
      let current = metadataRef.current;
      current = await interactiveAuthoringClient.saveExperienceDetails(experienceId, next, baseline.experience.updatedAt);
      updateMetadata(current);
      settingsBaselineRef.current = { ...baseline, experience: current.experience };
      current = await interactiveAuthoringClient.saveExperienceSpec(experienceId, next.experienceSpec, baseline.experienceSpec.versionIndex);
      updateMetadata(current);
      settingsBaselineRef.current = { ...settingsBaselineRef.current, experienceSpec: current.experienceSpec };
      current = await interactiveAuthoringClient.saveStoryArchitecture(experienceId, next.storyArchitecture, baseline.storyArchitecture.versionIndex);
      updateMetadata(current);
      setBindings(current.bindings);
      setSettingsPanel(null);
      await refreshAuthoringStatus();
      toast.success('作品设置已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '作品设置未全部保存，请检查后重试');
    } finally { settingsSavingRef.current = false; }
  };
  const handleSaveStateSchema = async (next: StateSchema) => {
    if (settingsSavingRef.current || adoptingRef.current || !metadataRef.current) return;
    const baselineVersion = (settingsBaselineRef.current || metadataRef.current).stateSchema.versionIndex;
    if (!(await savePendingGraph())) return;
    settingsSavingRef.current = true;
    try {
      const result = await interactiveAuthoringClient.saveStateSchema(experienceId, next, baselineVersion);
      updateMetadata(result);
      setBindings(result.bindings);
      setSettingsPanel(null);
      toast.success('故事状态已保存');
    } catch (error) { toast.error(error instanceof Error ? error.message : '故事状态保存失败'); }
    finally { settingsSavingRef.current = false; }
  };

  useEffect(() => {
    if (!hasUnsavedChanges && !layoutPending) return;
    const guardLink = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!link || link.origin !== window.location.origin || link.pathname === window.location.pathname && link.search === window.location.search) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void leaveWhiteboard(`${link.pathname}${link.search}${link.hash}`);
    };
    document.addEventListener('click', guardLink, true);
    return () => document.removeEventListener('click', guardLink, true);
  }, [hasUnsavedChanges, layoutPending, graph, experienceId]);

  const canvasFitViewRef = useRef<((nodeId?: string) => void) | null>(null);

  // Node CRUD operations
  const handleAddNode = () => {
    if (!graph || adoptingRef.current) return;
    const nodeIndex = graph.nodes.length;
    const newNode = createNewNode(nodeIndex);
    if (activeStoryUnit && activeStoryUnit.id !== 'unassigned') {
      const chapter = storyArchitecture?.storyChapters?.find((item) => item.id === activeStoryUnit.id);
      const availableBeatId = chapter?.storyBeatIds.find((beatId) => (
        !graph.nodes.some((node) => node.storyBeatIds?.includes(beatId))
      )) || chapter?.storyBeatIds[0];
      if (availableBeatId) newNode.storyBeatIds = [availableBeatId];
    }
    setGraph((current) => {
      if (!current) return current;
      return {
        ...current,
        nodes: [...current.nodes, newNode],
        entryNodeId: current.entryNodeId || newNode.id,
      };
    });
    const positions = { ...lightweightStoryPositions(graph), ...(layoutSaver.current?.current.nodes || {}) };
    const anchor = positions[selectedNodeId];
    const maxX = Math.max(100, ...Object.values(positions).map((point) => point.x));
    handleChangeLayout({ nodes: { [newNode.id]: { x: anchor ? anchor.x + 340 : maxX + 340, y: anchor?.y ?? 150 } } });
    setSelectedNodeId(newNode.id);
    setSelectedChoiceId('');
    setHasUnsavedChanges(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => canvasFitViewRef.current?.(newNode.id));
    });
    toast.success(`已添加节点: ${newNode.brief.title}`);
  };

  const handleUpdateNode = (nodeId: string, patch: Partial<Pick<NarrativeNode, 'brief' | 'interaction' | 'contract' | 'storyBeatIds'>>) => {
    if (!graph || adoptingRef.current) return;
    setGraph({ ...graph, nodes: graph.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node) });
    setHasUnsavedChanges(true);
  };
  const handleUpdateNodeBrief = (nodeId: string, patch: Partial<NarrativeNode['brief']>) => {
    const node = graph?.nodes.find((item) => item.id === nodeId);
    if (node) handleUpdateNode(nodeId, { brief: { ...node.brief, ...patch } });
  };

  const handleMoveToChapter = async (nodeId: string, chapterId: string) => {
    if (settingsSavingRef.current || adoptingRef.current || !metadataRef.current) return;
    if (!(await savePendingGraph())) return;
    const currentGraph = graphRef.current;
    const node = currentGraph?.nodes.find((item) => item.id === nodeId);
    if (!currentGraph || !node) return;
    const architecture = structuredClone(metadataRef.current.storyArchitecture.data);
    const beats = architecture.storyBeats || [];
    const others = new Set(currentGraph.nodes.filter((item) => item.id !== nodeId).flatMap((item) => item.storyBeatIds || []));
    const previousIds = node.storyBeatIds || [];
    const ownedIds = new Set(previousIds.filter((id) => !others.has(id)));
    const replacements = previousIds.map((id) => {
      const beat = beats.find((item) => item.id === id);
      return beat ? { ...beat, id: others.has(id) ? `beat_${crypto.randomUUID().slice(0, 8)}` : id, storyChapterId: chapterId || undefined } : null;
    }).filter((beat): beat is NonNullable<typeof beat> => Boolean(beat));
    if (!replacements.length) replacements.push({
      id: `beat_${crypto.randomUUID().slice(0, 8)}`, title: node.brief.title,
      dramaticPurpose: node.brief.intent, kind: node.brief.dramaticFunction === 'ending' ? 'ending' : 'variable',
      durationRangeSec: node.interaction?.durationRangeSec || [45, 90], storyChapterId: chapterId || undefined,
    });
    const nextIds = replacements.map((beat) => beat.id);
    architecture.storyBeats = [...beats.filter((beat) => !ownedIds.has(beat.id)), ...replacements];
    architecture.storyChapters = (architecture.storyChapters || []).map((chapter) => ({
      ...chapter, storyBeatIds: [...chapter.storyBeatIds.filter((id) => !ownedIds.has(id)), ...(chapter.id === chapterId ? nextIds : [])],
    }));
    settingsSavingRef.current = true;
    try {
      const result = await interactiveAuthoringClient.saveStoryArchitecture(experienceId, architecture, metadataRef.current.storyArchitecture.versionIndex);
      updateMetadata(result);
      setBindings(result.bindings);
      setGraph((latest) => latest ? { ...latest, nodes: latest.nodes.map((item) => item.id === nodeId ? { ...item, storyBeatIds: nextIds } : item) } : latest);
      setHasUnsavedChanges(true);
      if (await savePendingGraph()) toast.success(chapterId ? '节点已归入章节' : '节点已移出章节');
    } catch (error) { toast.error(error instanceof Error ? error.message : '章节归属保存失败'); }
    finally { settingsSavingRef.current = false; }
  };

  const handleDeleteNode = (nodeId: string) => {
    if (!graph || adoptingRef.current) return;
    const referencesNode = (condition: InteractiveChoice['condition']): boolean => {
      if (!condition) return false;
      if (condition.op === 'visited') return condition.nodeId === nodeId;
      if (condition.op === 'not') return referencesNode(condition.predicate);
      return (condition.op === 'all' || condition.op === 'any') && condition.predicates.some(referencesNode);
    };
    const dependentChoice = graph.nodes.filter((node) => node.id !== nodeId).flatMap((node) => node.choices)
      .find((choice) => choice.targetNodeId !== nodeId && referencesNode(choice.condition));
    if (dependentChoice) {
      toast.error(`请先修改选择“${dependentChoice.text}”对本节点的访问条件，再删除节点`);
      return;
    }
    const updatedNodes = graph.nodes.filter((n) => n.id !== nodeId);
    const clearDeletedTimeout = <T extends InteractiveChoice,>(choice: T): T => choice.defaultTimeoutTargetNodeId === nodeId
      ? { ...choice, timeoutSeconds: undefined, defaultTimeoutTargetNodeId: undefined } : choice;
    const updatedTransitions = (graph.transitions || []).filter(
      (t) => t.sourceNodeId !== nodeId && t.targetNodeId !== nodeId
    ).map(clearDeletedTimeout);
    let newEntryId = graph.entryNodeId;
    if (graph.entryNodeId === nodeId) {
      newEntryId = updatedNodes[0]?.id || '';
    }

    setGraph({
      ...graph,
      nodes: updatedNodes.map((n) => ({
        ...n,
        choices: n.choices.filter((c) => c.targetNodeId !== nodeId).map(clearDeletedTimeout),
      })),
      transitions: updatedTransitions,
      entryNodeId: newEntryId,
    });

    if (selectedNodeId === nodeId) setSelectedNodeId('');
    setHasUnsavedChanges(true);
    toast.success('节点已删除');
  };

  const handleSetAsEntryNode = (nodeId: string) => {
    if (!graph || adoptingRef.current) return;
    setGraph({ ...graph, entryNodeId: nodeId });
    setHasUnsavedChanges(true);
    toast.success('已设为图谱起点');
  };

  // Edge & Choice CRUD operations
  const handleConnectNodes = (sourceNodeId: string, targetNodeId: string) => {
    if (!graph || adoptingRef.current) return;
    const source = graph.nodes.find((node) => node.id === sourceNodeId);
    if (!source || !graph.nodes.some((node) => node.id === targetNodeId)) return;
    if (hasNodeCapability(source, 'terminal')) { toast.error('结局节点不能继续分支，请先修改节点类型'); return; }
    const choiceId = `choice_${crypto.randomUUID().slice(0, 8)}`;
    const choice: InteractiveChoice = {
      id: choiceId,
      text: '新分支路径',
      intent: '玩家决定探索此分支',
      targetNodeId,
      effects: [],
    };

    const updatedNodes = graph.nodes.map((n) => {
      if (n.id !== sourceNodeId) return n;
      const currentCapabilities = nodeCapabilities(n);
      const capabilities: NodeCapability[] = currentCapabilities.includes('present_choice')
        ? currentCapabilities
        : [...currentCapabilities, 'present_choice'];
      return {
        ...n,
        choices: [...n.choices, choice],
        interaction: {
          ...n.interaction,
          capabilities,
          contentPolicy: n.interaction?.contentPolicy || 'create_shared_content',
          durationRangeSec: n.interaction?.durationRangeSec || [45, 90],
          playerKnowledgeIn: n.interaction?.playerKnowledgeIn || [],
          playerKnowledgeOut: n.interaction?.playerKnowledgeOut || [],
        },
      };
    });

    const updatedTransitions = [
      ...(graph.transitions || []),
      { ...choice, sourceNodeId },
    ];

    setGraph({ ...graph, nodes: updatedNodes, transitions: updatedTransitions });
    setSelectedChoiceId(choice.id);
    setSelectedNodeId('');
    setHasUnsavedChanges(true);
    toast.success('新分支已建立');
  };

  const handleSaveChoice = (choiceId: string, patch: Partial<InteractiveChoice>) => {
    if (!graph || adoptingRef.current) return;
    const updatedTransitions = (graph.transitions || []).map((t) =>
      t.id === choiceId ? { ...t, ...patch } : t
    );
    const updatedNodes = graph.nodes.map((n) => ({
      ...n,
      choices: n.choices.map((c) => (c.id === choiceId ? { ...c, ...patch } : c)),
    }));

    setGraph({ ...graph, nodes: updatedNodes, transitions: updatedTransitions });
    setHasUnsavedChanges(true);
    toast.success('分支配置已更新');
  };

  const handleDeleteChoice = (choiceId: string) => {
    if (!graph || adoptingRef.current) return;
    const updatedTransitions = (graph.transitions || []).filter((t) => t.id !== choiceId);
    const updatedNodes = graph.nodes.map((n) => ({
      ...n,
      choices: n.choices.filter((c) => c.id !== choiceId),
    }));

    setGraph({ ...graph, nodes: updatedNodes, transitions: updatedTransitions });
    if (selectedChoiceId === choiceId) setSelectedChoiceId('');
    setHasUnsavedChanges(true);
    toast.success('分支选项已删除');
  };

  // Auto Layout
  const handleAutoLayout = async () => {
    if (!graph || adoptingRef.current) return;
    const { buildStoryFlowPositions } = await import('../domains/interactive/layout/graphAutoLayout');
    const newPositions = buildStoryFlowPositions(graph);
    handleChangeLayout({ nodes: newPositions });
    if (await flushLayout()) toast.success('画布已重排并保存');
  };

  // AI Draft Generation & Adoption Workflow
  const executeGenerateAiDraft = async (params: {
    action: AiActionType;
    authorIntent: string;
    scopeNodeId?: string;
    strategy?: 'foldback' | 'parallel' | 'failure';
    issueIds?: string[];
    revisionOfDraftId?: string;
  }, finalPrompt: string) => {
    if (!experienceId) return;
    if (!(await savePendingGraph())) throw new Error('请先完成白板保存，再生成候选');
    const expectedGraphVersionIndex = graphRef.current?.versionIndex;
    try {
      setIsGeneratingDraft(true);
      const draft = await interactiveAuthoringClient.createDraft(experienceId, {
        action: params.action,
        authorIntent: finalPrompt,
        scopeNodeId: params.scopeNodeId,
        strategy: params.strategy,
        issueIds: params.issueIds,
        revisionOfDraftId: params.revisionOfDraftId,
        expectedGraphVersionIndex,
      });

      setActiveDraft(draft);
      setIsAiDrawerOpen(false);
      toast.success('AI 草案生成完毕，请审阅差异');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 草案生成失败';
      if (message.includes('等待时间过长')) {
        let recovered: InteractiveGraphDraft | null = null;
        for (let attempt = 0; attempt < 3 && !recovered; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 5_000));
          const latest = await interactiveAuthoringClient.getLatestDraft(experienceId).catch(() => null);
          if (latest?.status === 'candidate' && latest.authorIntent === finalPrompt) recovered = latest;
        }
        if (recovered) {
          setActiveDraft(recovered);
          setIsAiDrawerOpen(false);
          toast.success('AI 方案已准备好，请审阅');
          return;
        }
      }
      throw error;
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const handleGenerateAiDraft = (params: {
    action: AiActionType;
    authorIntent: string;
    scopeNodeId?: string;
    strategy?: 'foldback' | 'parallel' | 'failure';
    issueIds?: string[];
  }) => {
    const selectedNode = graph?.nodes.find((node) => node.id === params.scopeNodeId);
    const actionLabel = params.action === 'extend'
      ? '从当前节点继续设计后续选择和结果。'
      : params.action === 'repair'
        ? '修复当前白板检查发现的问题，同时保持已有故事意图。'
        : params.action === 'initial'
          ? '搭建完整、可审阅的第一版互动故事结构。'
          : '根据作者意见调整整张白板的主线、分支、节奏和结局。';
    setPromptRequest({
      title: '调整互动故事 - 提示词确认',
      templateId: 'interactiveGraphAuthoring',
      variables: {
        actionLabel,
        graphContext: graphContextForPrompt(graph),
        selectedNodeContext: selectedNode
          ? JSON.stringify({
            id: selectedNode.id,
            title: selectedNode.brief.title,
            summary: selectedNode.brief.narrativeSummary,
          }, null, 2)
          : '本次处理整张白板',
        qaContext: params.issueIds?.length ? params.issueIds.join('\n') : '没有指定结构问题',
        authorRequest: params.authorIntent,
      },
      execute: (finalPrompt) => executeGenerateAiDraft(params, finalPrompt),
    });
  };

  const handleAdoptDraft = async (draftId: string) => {
    if (!experienceId || adoptingRef.current) return;
    if (dirtyRef.current) {
      if (await savePendingGraph()) toast.error('手动修改已保存，请基于新白板重新生成候选再采用');
      return;
    }
    adoptingRef.current = true;
    try {
      setIsAdoptingDraft(true);
      const res = await interactiveAuthoringClient.adoptDraft(experienceId, draftId);
      if (res.success && res.newGraph) {
        setGraph({ ...res.newGraph, locked: false });
        try { localStorage.removeItem(draftKey); } catch { /* Saved remotely. */ }
        if (res.stateSchema) setStateSchema(res.stateSchema);
        if (res.storyArchitecture) setStoryArchitecture(res.storyArchitecture);
        setActiveDraft(null);
        setContentPlanCandidate(null);
        setActiveContentPlan(null);
        setProductionPlanCandidate(null);
        setActiveProductionPlan(null);
        setMediaPlanCandidate(null);
        setActiveMediaPlan(null);
        setHasUnsavedChanges(false);
        updateMetadata(await interactiveClient.getWhiteboardExperience(experienceId));
        await refreshAuthoringStatus();
        toast.success('AI 草案已成功采用到白板');
      } else {
        toast.error(`采用失败: ${res.reason || '版本冲突'}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '采用草案失败');
    } finally {
      adoptingRef.current = false;
      setIsAdoptingDraft(false);
    }
  };

  const handleRejectDraft = async (draftId: string) => {
    if (!experienceId) return;
    try {
      await interactiveAuthoringClient.rejectDraft(experienceId, draftId);
      setActiveDraft(null);
      toast('草案已放弃', { icon: '🗑️' });
    } catch (error) {
      toast.error('操作失败');
    }
  };

  const handleRequestDraftRevision = (draft: InteractiveGraphDraft, feedback: string) => {
    if (!experienceId || !graph) return;
    const action: AiActionType = draft.scope.type === 'repair'
      ? 'repair'
      : draft.scope.type === 'from_node' ? 'extend' : graph.nodes.length === 0 ? 'initial' : 'revise';
    const params = {
      action,
      authorIntent: feedback,
      revisionOfDraftId: draft.id,
      scopeNodeId: draft.scope.type === 'from_node' ? draft.scope.nodeId : undefined,
      issueIds: draft.scope.type === 'repair' ? draft.scope.issueIds : undefined,
    };
    setPromptRequest({
      title: '按意见修改故事 - 提示词确认',
      templateId: 'interactiveGraphAuthoring',
      variables: {
        actionLabel: '根据作者反馈修改当前候选，只调整真正受影响的故事结构。',
        graphContext: graphContextForPrompt(graph),
        selectedNodeContext: params.scopeNodeId || '本次处理整张白板',
        qaContext: params.issueIds?.join('\n') || '没有指定结构问题',
        authorRequest: feedback,
      },
      execute: async (finalPrompt) => {
        await executeGenerateAiDraft(params, finalPrompt);
        await interactiveAuthoringClient.rejectDraft(experienceId, draft.id);
      },
    });
  };

  // Navigation Handoffs
  const openWritingForNode = (nodeId?: string) => {
    const returnTo = `/interactive/experiences/${encodeURIComponent(experienceId)}/graph${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`;
    const projectQuery = storySource.writingProjectId
      ? `projectId=${encodeURIComponent(storySource.writingProjectId)}&`
      : '';
    void leaveWhiteboard(`/writing?${projectQuery}returnTo=${encodeURIComponent(returnTo)}&bindOnReturn=1`);
  };

  const executePrepareNodeContent = async (nodeId: string, finalPrompt: string) => {
    setPreparingContentNodeId(nodeId);
    setIsWorkingOnContentPlan(true);
    try {
      if (!(await savePendingGraph())) throw new Error('请先完成白板保存');
      const plan = await interactiveClient.createContentPlan(experienceId, finalPrompt);
      setContentPlanCandidate(plan);
      setActiveContentPlan(plan);
      setSelectedNodeId('');
      toast.success('AI 已给出整张白板的内容安排');
    } finally {
      setPreparingContentNodeId('');
      setIsWorkingOnContentPlan(false);
    }
  };

  const handlePrepareNodeContent = (nodeId: string) => {
    const existing = bindings.find((binding) => (
      binding.nodeId === nodeId
      && binding.slot === 'main'
      && bindingScriptSceneRefs(binding).length > 0
    ));
    if (existing || !storySource.writingProjectId) {
      openWritingForNode(nodeId);
      return;
    }
    const nodeTitle = graph?.nodes.find((node) => node.id === nodeId)?.brief.title || '当前节点';
    setPromptRequest({
      title: '安排节点内容 - 提示词确认',
      templateId: 'interactiveContentPlanning',
      variables: {
        graphContext: graphContextForPrompt(graph),
        writingContext: contentPlanScenes.length
          ? JSON.stringify(contentPlanScenes.map((scene) => ({
            title: scene.sceneTitle,
            synopsis: scene.synopsis,
          })), null, 2)
          : '系统将在执行时读取当前 Writing 项目的正式场次',
        authorRequest: `重点解决“${nodeTitle}”尚未准备内容的问题。`,
      },
      execute: (finalPrompt) => executePrepareNodeContent(nodeId, finalPrompt),
    });
  };

  const handleAdoptContentPlan = async (draftId: string) => {
    setIsWorkingOnContentPlan(true);
    try {
      const result = await interactiveClient.adoptContentPlan(experienceId, draftId);
      setBindings(result.aggregate.bindings || []);
      setContentPlanCandidate(null);
      setActiveContentPlan(null);
      await refreshAuthoringStatus();
      if (result.productionPlan) {
        setProductionPlanCandidate(result.productionPlan);
        setActiveProductionPlan(result.productionPlan);
        toast.success('节点内容已采用，AI 也准备好了制片方案');
      } else {
        toast.success('整套节点内容方案已采用');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '内容方案采用失败');
    } finally {
      setIsWorkingOnContentPlan(false);
    }
  };

  const handleMapWritingContent = async (changes: ContentMappingChange[]) => {
    if (!(await savePendingGraph())) throw new Error('请先完成白板保存');
    const allRefs = new Map(bindings.filter((binding) => binding.slot === 'main').map((binding) => [binding.nodeId, bindingScriptSceneRefs(binding)]));
    changes.forEach((change) => allRefs.set(change.nodeId, change.scenes.map((scene) => scene.ref)));
    const useCounts = new Map<string, number>();
    allRefs.forEach((refs) => refs.forEach((ref) => { const key = artifactRefIdentity(ref); useCounts.set(key, (useCounts.get(key) || 0) + 1); }));
    const reviewedBindings = changes.map(({ nodeId, scenes, action, rationale }): Pick<NodeContentBinding, 'nodeId' | 'slot' | 'versionIndex' | 'scriptSceneRefs' | 'contentFitReview' | 'reusePolicy' | 'status'> => {
      const existing = bindings.find((binding) => binding.nodeId === nodeId && binding.slot === 'main');
      return {
        nodeId, slot: 'main', versionIndex: existing?.versionIndex,
        scriptSceneRefs: scenes.map((scene) => scene.ref),
        contentFitReview: action === 'clear' ? undefined : {
          verdict: 'pass', rationale, reviewedAt: new Date().toISOString(), sceneChecksums: scenes.map((scene) => scene.ref.checksum),
        },
        reusePolicy: scenes.some((scene) => (useCounts.get(artifactRefIdentity(scene.ref)) || 0) > 1) ? 'compatible_states_only' : 'exclusive',
        status: action === 'clear' ? 'draft' : 'approved',
      };
    });
    const aggregate = await interactiveClient.saveScriptBindings(experienceId, reviewedBindings);
    setBindings(aggregate.bindings);
    await refreshAuthoringStatus();
    toast.success(`已更新 ${changes.length} 个节点的剧本引用`);
  };

  const handleOpenContentMapping = async () => {
    try {
      if (hasUnsavedChanges && !(await savePendingGraph())) return;
      const scenes = await interactiveClient.listWritingSceneSummaries(experienceId);
      if (!scenes.length && !bindings.some((binding) => bindingScriptSceneRefs(binding).length)) {
        toast.error('当前剧本还没有可映射的正式场次');
        return;
      }
      setContentPlanScenes(scenes);
      setIsContentMappingOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法读取当前剧本场次');
    }
  };

  const handleRejectContentPlan = async (draftId: string) => {
    setIsWorkingOnContentPlan(true);
    try {
      await interactiveClient.rejectContentPlan(experienceId, draftId);
      setContentPlanCandidate(null);
      setActiveContentPlan(null);
      toast('已放弃这版内容安排');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '内容方案状态更新失败');
    } finally {
      setIsWorkingOnContentPlan(false);
    }
  };

  const handleReviseContentPlan = (draftId: string, feedback: string) => {
    setPromptRequest({
      title: '修改节点内容安排 - 提示词确认',
      templateId: 'interactiveContentPlanning',
      variables: {
        graphContext: graphContextForPrompt(graph),
        writingContext: contentPlanScenes.length
          ? JSON.stringify(contentPlanScenes.map((scene) => ({
            title: scene.sceneTitle,
            synopsis: scene.synopsis,
          })), null, 2)
          : '系统将在执行时读取当前 Writing 项目的正式场次',
        authorRequest: feedback,
      },
      execute: async (finalPrompt) => {
        setIsWorkingOnContentPlan(true);
        try {
          const revised = await interactiveClient.reviseContentPlan(experienceId, draftId, finalPrompt);
          setContentPlanCandidate(revised);
          setActiveContentPlan(revised);
          toast.success('AI 已按你的意见重新安排全部节点内容');
        } finally {
          setIsWorkingOnContentPlan(false);
        }
      },
    });
  };

  const handleRequestMissingWriting = () => openWritingForNode();

  const handlePrimaryAiAction = async () => {
    try {
      if (authoringStatus?.paused) {
        const resumed = await interactiveClient.setAuthoringPaused(experienceId, false);
        setAuthoringStatus(resumed);
        toast.success('AI 已继续创作');
        return;
      }
      if (authoringStatus?.nextAction === 'prepare_story' || authoringStatus?.nextAction === 'review_story') {
        openWritingForNode();
        return;
      }
      if (authoringStatus?.nextAction === 'playtest') {
        handlePlaytest();
        return;
      }
      if (authoringStatus?.nextAction === 'prepare_content' && graph?.nodes.length) {
        const firstMissing = graph.nodes.find((node) => (
          hasNodeCapability(node, 'play_content')
          && !bindings.some((binding) => binding.nodeId === node.id && bindingScriptSceneRefs(binding).length > 0)
        ));
        if (firstMissing) handlePrepareNodeContent(firstMissing.id);
        return;
      }
      const latestContentPlan = activeContentPlan
        || contentPlanCandidate
        || await interactiveClient.getLatestContentPlan(experienceId);
      if (latestContentPlan?.status === 'candidate') {
        setContentPlanCandidate(latestContentPlan);
        setActiveContentPlan(latestContentPlan);
        return;
      }
      const hasMissingContent = graph?.nodes.some((node) => (
        hasNodeCapability(node, 'play_content')
        && !bindings.some((binding) => (
          binding.nodeId === node.id
          && binding.slot === 'main'
          && binding.status === 'approved'
          && bindingScriptSceneRefs(binding).length > 0
        ))
      ));
      if (hasMissingContent && graph?.nodes.length) {
        const firstMissing = graph.nodes.find((node) => (
          hasNodeCapability(node, 'play_content')
          && !bindings.some((binding) => binding.nodeId === node.id && bindingScriptSceneRefs(binding).length > 0)
        ));
        if (firstMissing) handlePrepareNodeContent(firstMissing.id);
        return;
      }
      const latestProductionPlan = activeProductionPlan
        || productionPlanCandidate
        || await interactiveClient.getLatestProductionPlan(experienceId);
      if (latestProductionPlan?.status === 'candidate') {
        setProductionPlanCandidate(latestProductionPlan);
        setActiveProductionPlan(latestProductionPlan);
        setSelectedNodeId('');
        return;
      }
      if (latestProductionPlan?.status === 'adopted') {
        const mediaPlan = await interactiveClient.createMediaPlan(experienceId);
        setMediaPlanCandidate(mediaPlan);
        setActiveMediaPlan(mediaPlan);
        setSelectedNodeId('');
        return;
      }
      const latestMediaPlan = activeMediaPlan
        || mediaPlanCandidate
        || await interactiveClient.getLatestMediaPlan(experienceId).catch(() => null);
      if (latestMediaPlan?.status === 'candidate') {
        const refreshedMediaPlan = await interactiveClient.createMediaPlan(experienceId);
        setMediaPlanCandidate(refreshedMediaPlan);
        setActiveMediaPlan(refreshedMediaPlan);
        setSelectedNodeId('');
        return;
      }
      if (authoringStatus?.nextAction === 'prepare_production') {
        setIsWorkingOnProductionPlan(true);
        const plan = await interactiveClient.createProductionPlan(experienceId);
        setProductionPlanCandidate(plan);
        setActiveProductionPlan(plan);
        setSelectedNodeId('');
        return;
      }
      setIsAiDrawerOpen(true);
    } catch (error) {
      toast.error(creatorFacingInteractiveAiError(error, 'AI 共创入口暂时不可用，现有白板内容不会丢失。'));
    } finally {
      setIsWorkingOnProductionPlan(false);
    }
  };

  const handleAdoptProductionPlan = async () => {
    if (!activeProductionPlan) return;
    setIsWorkingOnProductionPlan(true);
    try {
      await interactiveClient.adoptProductionPlan(experienceId, activeProductionPlan.id);
      setProductionPlanCandidate(null);
      setActiveProductionPlan(null);
      const mediaPlan = await interactiveClient.createMediaPlan(experienceId);
      setMediaPlanCandidate(mediaPlan);
      setActiveMediaPlan(mediaPlan);
      toast.success('制片场次和复用关系已准备好');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '制片方案采用失败');
    } finally {
      setIsWorkingOnProductionPlan(false);
    }
  };

  const handleAdoptMediaPlan = async () => {
    if (!activeMediaPlan) return;
    setIsWorkingOnProductionPlan(true);
    try {
      const result = await interactiveClient.adoptMediaPlan(experienceId, activeMediaPlan.id);
      setBindings(result.aggregate.bindings || []);
      setMediaPlanCandidate(null);
      setActiveMediaPlan(null);
      await interactiveClient.createRuntimeBuild(experienceId);
      await refreshAuthoringStatus();
      toast.success('视频已采用，可以试玩完整故事');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '视频方案采用失败');
    } finally {
      setIsWorkingOnProductionPlan(false);
    }
  };

  const handleRequestMediaRevision = (nodeId: string, feedback: string, scenarioId?: string) => {
    if (!activeMediaPlan) return;
    const node = graph?.nodes.find((item) => item.id === nodeId);
    setPromptRequest({
      title: '修改节点画面 - 提示词确认',
      templateId: 'interactiveMediaRevision',
      variables: {
        nodeContext: JSON.stringify({
          id: nodeId,
          title: node?.brief.title || '故事节点',
          summary: node?.brief.narrativeSummary || '',
        }, null, 2),
        mediaContext: JSON.stringify(activeMediaPlan.selections.find((item) => (
          item.nodeId === nodeId && (scenarioId ? item.scenarioId === scenarioId : true)
        )) || {
          nodeId,
          status: '尚无可采用视频',
        }, null, 2),
        authorRequest: feedback,
      },
      execute: async (finalPrompt) => {
        setIsWorkingOnProductionPlan(true);
        try {
          const refreshed = await interactiveClient.requestMediaPlanRevision(
            experienceId,
            activeMediaPlan.id,
            nodeId,
            finalPrompt,
            scenarioId,
          );
          setMediaPlanCandidate(refreshed);
          setActiveMediaPlan(refreshed);
          toast.success('AI 已记下这条意见，其他节点的视频会保留');
        } finally {
          setIsWorkingOnProductionPlan(false);
        }
      },
    });
  };

  const handleRejectProductionPlan = async () => {
    if (!activeProductionPlan) return;
    setIsWorkingOnProductionPlan(true);
    try {
      await interactiveClient.rejectProductionPlan(experienceId, activeProductionPlan.id);
      setProductionPlanCandidate(null);
      setActiveProductionPlan(null);
      toast('已放弃这版制片方案');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法更新制片方案');
    } finally {
      setIsWorkingOnProductionPlan(false);
    }
  };

  const handleOpenProductionHandoff = (nodeId: string) => {
    void leaveWhiteboard(`/interactive/experiences/${encodeURIComponent(experienceId)}/production?nodeId=${encodeURIComponent(nodeId)}&returnTo=graph`);
  };

  const handlePlaytest = () => {
    void leaveWhiteboard(`/interactive/experiences/${encodeURIComponent(experienceId)}/playtest`);
  };

  const handleSelectNode = useCallback((id: string) => {
    setSelectedNodeId(id);
    setSelectedChoiceId('');
  }, []);

  const handleSelectChoice = useCallback((_sourceNodeId: string, choiceId: string) => {
    setSelectedChoiceId(choiceId);
    setSelectedNodeId('');
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId('');
    setSelectedChoiceId('');
  }, []);


  if (!graph) {
    return (
      <div className="flex h-full w-full min-w-0 items-center justify-center bg-bg-primary text-text-primary transition-colors duration-200">
        <Loader2 className="w-8 h-8 animate-spin text-gold mr-2.5" />
        <span className="text-sm font-bold text-text-primary">正在载入白板画布...</span>
      </div>
    );
  }

  return (
    <div className={`flex h-full w-full min-w-0 flex-col overflow-hidden bg-bg-primary text-text-primary transition-colors duration-200 ${isFullscreen ? 'fixed inset-0 z-50 h-[100dvh] w-screen' : ''}`}>
      {/* Top Header Navigation */}
      {recoveryConflict && <div className="border-b border-amber-500/40 bg-amber-500/10 px-5 py-2 text-xs text-amber-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>本机草稿基于图谱版本 {recoveryConflict.versionIndex}，服务器现为版本 {loadedGraphVersion}。本机内容仍保存在浏览器中。</span>
          <div className="flex gap-2">
            <button type="button" className="rounded border border-amber-500/50 px-2 py-1" onClick={() => {
              const url = URL.createObjectURL(new Blob([JSON.stringify(recoveryConflict, null, 2)], { type: 'application/json' }));
              const link = document.createElement('a'); link.href = url; link.download = `interactive-graph-draft-${experienceId}.json`; link.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}>下载本机草稿</button>
            <button type="button" className="rounded border border-amber-500/50 px-2 py-1" onClick={() => {
              if (!window.confirm('已检查差异。下一次保存将以本机草稿替换服务器较新图谱，确定继续？')) return;
              setGraph({ ...recoveryConflict, versionIndex: loadedGraphVersion, locked: false });
              setHasUnsavedChanges(true);
              setRecoveryConflict(null);
            }}>用本机草稿继续编辑</button>
          </div>
        </div>
        <details className="mt-1"><summary className="cursor-pointer">查看节点差异</summary><p className="mt-1">本机：{recoveryConflict.nodes.map((node) => node.brief.title).join('、') || '无节点'}</p><p>服务器：{loadedServerGraph?.nodes.map((node) => node.brief.title).join('、') || '无节点'}</p></details>
      </div>}
      <InteractiveWhiteboardHeader
        title={experienceTitle}
        genre={genre}
        hasUnsavedChanges={hasUnsavedChanges || layoutPending}
        primaryActionLabel={isWorkingOnContentPlan
          ? '正在安排内容'
          : isWorkingOnProductionPlan
              ? '正在准备制片'
              : mediaPlanCandidate
                ? mediaPlanCandidate.missingNodeIds.length ? '继续制作画面' : '查看画面方案'
              : productionPlanCandidate
                ? '查看制片方案'
                : authoringStatus?.nextActionLabel
                  || (contentPlanCandidate ? '查看 AI 方案' : 'AI 共创')}
        primaryActionDisabled={
          isWorkingOnContentPlan
          || isWorkingOnProductionPlan
          || authoringStatus?.content.state === 'working'
        }
        onBack={() => void leaveWhiteboard('/interactive')}
        onOpenAiDrawer={() => void handlePrimaryAiAction()}
        onRunAudit={() => {
          if (!qaResult?.issues.length) {
            toast.success('故事结构、选择和时长检查全部通过');
          } else if (qaResult.passed) {
            toast(`检查通过，还有 ${qaResult.issues.length} 项需要留意`);
          } else {
            toast.error(`检查发现 ${qaResult?.issues.length || 0} 项存在问题，AI 可以给出修复方案`);
            setSelectedNodeId('');
            setSelectedChoiceId('');
            setIsAiDrawerOpen(true);
          }
        }}
        onPlaytest={handlePlaytest}
        onSave={handleSaveGraph}
      />

      {layoutError && <div role="alert" className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-text-primary">画布位置未保存：{layoutError}<button type="button" className="ml-3 underline" onClick={() => void flushLayout()}>重试保存</button></div>}
      {/* Main Canvas Container */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        {authoringStatus && (
          <div className="absolute bottom-12 left-14 z-20 flex h-9 max-w-72 items-center gap-2 rounded-xl border border-border-soft/40 bg-bg-surface/95 dark:bg-neutral-900/95 px-3 py-1.5 shadow-xl backdrop-blur-xl transition-colors" role="status">
            <Sparkles className="h-4 w-4 shrink-0 text-gold" />
            <span className="truncate text-xs font-bold text-text-primary">
              {authoringStatus.writing.state === 'failed'
                ? creatorFacingInteractiveAiError(
                  authoringStatus.writing.message,
                  '剧本 AI 暂时不可用；白板审阅和试玩仍可继续。',
                )
                : authoringStatus.writing.message}
            </span>
          </div>
        )}
        {/* Floating Canvas Toolbar */}
        <InteractiveCanvasToolbar
          onOpenSettings={() => { settingsBaselineRef.current = metadataRef.current; setSelectedNodeId(''); setSelectedChoiceId(''); setSettingsPanel('project'); }}
          onEditState={() => { settingsBaselineRef.current = metadataRef.current; setSelectedNodeId(''); setSelectedChoiceId(''); setSettingsPanel('state'); }}
          onOpenWriting={() => openWritingForNode()}
          onAddNode={handleAddNode}
          onAutoLayout={handleAutoLayout}
          onFitView={() => canvasFitViewRef.current?.()}
          onMapWritingContent={
            graph.nodes.length > 0 && storySource.writingProjectId
              ? () => void handleOpenContentMapping()
              : undefined
          }
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
        />
        <InteractiveStoryUnitSwitcher
          units={storyUnits}
          activeUnitId={activeStoryUnit?.id || ''}
          onSelect={(unitId) => {
            const unit = storyUnits.find((item) => item.id === unitId);
            setActiveStoryUnitId(unitId);
            setSelectedNodeId(unit?.nodeIds[0] || '');
            setSelectedChoiceId('');
          }}
        />

        {/* Infinite React Flow Canvas */}
        <InteractiveGraphCanvas
          key={activeStoryUnit?.id || 'full-graph'}
          graph={graph}
          layout={layout}
          bindings={bindings}
          visibleNodeIds={visibleNodeIds}
          selectedNodeId={selectedNodeId}
          selectedChoiceId={selectedChoiceId}
          onSelectNode={handleSelectNode}
          onSelectChoice={handleSelectChoice}
          onDeleteChoice={handleDeleteChoice}
          onConnectNodes={handleConnectNodes}
          onChangeLayout={handleChangeLayout}
          onPaneClick={handlePaneClick}
          onFitViewRef={canvasFitViewRef}
        />

        {/* Empty Canvas Master AI CTA Overlay */}
        {isEmptyGraph && (
          <div className="absolute inset-0 bg-bg-primary/80 backdrop-blur-md flex items-center justify-center p-6 z-20 select-none">
            <div className="max-w-md w-full p-8 rounded-3xl bg-bg-surface border border-border-soft/40 shadow-2xl text-center space-y-4 text-text-primary">
              <div className="w-14 h-14 rounded-2xl bg-gold/15 text-gold mx-auto flex items-center justify-center border border-gold/30">
                <Sparkles className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-extrabold text-text-primary">空白互动画布</h2>
              <p className="text-xs text-text-muted leading-relaxed">
                欢迎开始创作！你可以让 AI 从故事前提搭建基础蓝图与双结局，也可以手动加入第一个节点。
              </p>
              {storySource.writingProjectId && (
                <button
                  type="button"
                  onClick={() => {
                    openWritingForNode();
                  }}
                  className="flex w-full items-center justify-center gap-2 border border-border-soft/40 bg-bg-surface-soft px-3 py-2.5 text-xs font-bold text-text-primary hover:border-gold/60 rounded-xl transition-colors"
                >
                  <FileText className="h-4 w-4 text-gold" />
                  打开剧本工作区
                </button>
              )}
              <div className="pt-2 flex flex-col space-y-2">
                <button
                  onClick={() => setIsAiDrawerOpen(true)}
                  className="w-full py-3 rounded-xl bg-gold hover:bg-gold-light text-bg-primary font-bold text-sm flex items-center justify-center shadow-md shadow-gold/20 transition-all"
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  AI 帮我搭建互动蓝图
                </button>
                <button
                  onClick={handleAddNode}
                  className="w-full py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium text-xs border border-neutral-700/60 transition-colors flex items-center justify-center"
                >
                  <Plus className="w-4 h-4 mr-1 text-neutral-400" />
                  手动添加第一个节点
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        {settingsPanel === 'project' && settingsValue && <InteractiveProjectSettingsInspector value={settingsValue} onSave={(next) => void handleSaveSettings(next)} onClose={() => setSettingsPanel(null)} />}
        {settingsPanel === 'state' && stateSchema && <InteractiveStateSchemaInspector schema={stateSchema} onSave={(next) => void handleSaveStateSchema(next)} onClose={() => setSettingsPanel(null)} />}
        {isAiDrawerOpen && (
          <InteractiveAiDrawer
            isOpen
            onClose={() => setIsAiDrawerOpen(false)}
            selectedNodeTitle={selectedNode?.brief?.title}
            selectedNodeId={selectedNodeId}
            qaIssueCount={qaResult?.issues.length || 0}
            qaIssueIds={qaResult?.issues.map((issue) => issue.id) || []}
            isEmptyGraph={isEmptyGraph}
            isGenerating={isGeneratingDraft}
            isFullscreen={isFullscreen}
            onGenerate={handleGenerateAiDraft}
          />
        )}

        {promptRequest && (
          <PromptEditorModal
            isOpen
            onClose={() => setPromptRequest(null)}
            title={promptRequest.title}
            templateId={promptRequest.templateId}
            workflowStepId="manual.game.editor"
            variables={promptRequest.variables}
            onConfirm={promptRequest.execute}
          />
        )}

        {isContentMappingOpen && (
          <InteractiveContentMappingModal
            isOpen
            nodes={graph.nodes.filter((node) => hasNodeCapability(node, 'play_content'))}
            scenes={contentPlanScenes}
            bindings={bindings}
            loadScenes={(nodeId) => interactiveClient.listWritingScenes(experienceId, nodeId)}
            onClose={() => setIsContentMappingOpen(false)}
            onConfirm={handleMapWritingContent}
          />
        )}

        {activeDraft && (
          <InteractiveGraphDraftReview
            draft={activeDraft}
            onAdopt={handleAdoptDraft}
            onReject={handleRejectDraft}
            onRequestRevision={handleRequestDraftRevision}
            onClose={() => setActiveDraft(null)}
            isAdopting={isAdoptingDraft}
          />
        )}

        {activeContentPlan && !activeDraft && (
          <InteractiveContentPlanReview
            draft={activeContentPlan}
            nodes={graph.nodes}
            scenes={contentPlanScenes}
            isWorking={isWorkingOnContentPlan}
            onClose={() => setActiveContentPlan(null)}
            onAdopt={(draftId) => void handleAdoptContentPlan(draftId)}
            onReject={(draftId) => void handleRejectContentPlan(draftId)}
            onRequestRevision={(draftId, feedback) => void handleReviseContentPlan(draftId, feedback)}
            onDiscussStory={() => {
              setActiveContentPlan(null);
              setSelectedNodeId('');
              setIsAiDrawerOpen(true);
            }}
            onOpenWriting={() => void handleRequestMissingWriting()}
          />
        )}

        {activeProductionPlan && !activeDraft && !activeContentPlan && (
          <InteractiveProductionPlanReview
            plan={activeProductionPlan}
            isWorking={isWorkingOnProductionPlan}
            onClose={() => setActiveProductionPlan(null)}
            onAdopt={() => void handleAdoptProductionPlan()}
            onReject={() => void handleRejectProductionPlan()}
            onOpenProduction={() => void leaveWhiteboard(`/interactive/experiences/${encodeURIComponent(experienceId)}/production?returnTo=graph`)}
          />
        )}

        {activeMediaPlan && !activeDraft && !activeContentPlan && !activeProductionPlan && (
          <InteractiveMediaPlanReview
            plan={activeMediaPlan}
            isWorking={isWorkingOnProductionPlan}
            nodeTitles={Object.fromEntries((graph?.nodes || []).map((node) => [node.id, node.brief.title]))}
            onClose={() => setActiveMediaPlan(null)}
            onAdopt={() => void handleAdoptMediaPlan()}
            onRequestRevision={(nodeId, feedback, scenarioId) => void handleRequestMediaRevision(nodeId, feedback, scenarioId)}
            onOpenProduction={(nodeId) => void leaveWhiteboard(`/interactive/experiences/${encodeURIComponent(experienceId)}/production?returnTo=graph${nodeId ? `&nodeId=${encodeURIComponent(nodeId)}` : ''}`)}
          />
        )}

        {selectedNode && !settingsPanel && !activeDraft && !activeContentPlan && !activeProductionPlan && !activeMediaPlan && (
          <InteractiveNodeInspector
            key={selectedNode.id}
            node={selectedNode}
            isEntry={graph.entryNodeId === selectedNode.id}
            hasScriptBinding={bindings.some((b) => (
              b.nodeId === selectedNode.id && bindingScriptSceneRefs(b).length > 0
            ))}
            hasWritingProject={Boolean(storySource.writingProjectId)}
            isPreparingContent={preparingContentNodeId === selectedNode.id}
            hasMediaTake={bindings.some((b) => b.nodeId === selectedNode.id && Boolean(b.mediaTakeRefs?.length))}
            onClose={() => setSelectedNodeId('')}
            onUpdateBrief={handleUpdateNodeBrief}
            onUpdateNode={handleUpdateNode}
            chapters={storyArchitecture?.storyChapters || []}
            currentChapterId={storyPlacementForNode(storyArchitecture, selectedNode).storyChapterId}
            onMoveToChapter={(nodeId, chapterId) => void handleMoveToChapter(nodeId, chapterId)}
            stateSchema={stateSchema || undefined}
            onAddChoice={(nodeId) => {
              const defaultTarget = graph.nodes.find((n) => n.id !== nodeId)?.id || nodeId;
              handleConnectNodes(nodeId, defaultTarget);
            }}
            onSelectChoice={(choiceId) => { setSelectedNodeId(''); setSelectedChoiceId(choiceId); }}
            onDeleteNode={handleDeleteNode}
            onSetAsEntry={handleSetAsEntryNode}
            onAiExtendFromNode={(nodeId) => {
              setSelectedNodeId(nodeId);
              setIsAiDrawerOpen(true);
            }}
            onOpenWritingHandoff={openWritingForNode}
            onPrepareContent={handlePrepareNodeContent}
            onOpenProductionHandoff={handleOpenProductionHandoff}
          />
        )}

        {selectedChoice && !settingsPanel && !selectedNode && !activeDraft && !activeContentPlan && !activeProductionPlan && !activeMediaPlan && (
          <InteractiveChoiceInspector
            key={selectedChoice.id}
            stateSchema={stateSchema || undefined}
            choice={selectedChoice}
            allNodes={graph.nodes}
            onClose={() => setSelectedChoiceId('')}
            onSaveChoice={handleSaveChoice}
            onDeleteChoice={handleDeleteChoice}
          />
        )}
      </Suspense>

      {/* Bottom Path Analysis Drawer */}
      <InteractivePathDrawer
        isOpen={isPathDrawerOpen}
        onToggle={() => setIsPathDrawerOpen(!isPathDrawerOpen)}
        graph={graph}
        durationBudget={durationBudget}
        nodeDurationSeconds={nodeDurationSeconds}
        mappedScreenplayNodeCount={mappedScreenplayNodeCount}
        onFocusNode={(nodeId) => {
          setSelectedNodeId(nodeId);
          setSelectedChoiceId('');
        }}
      />
    </div>
  );
}
