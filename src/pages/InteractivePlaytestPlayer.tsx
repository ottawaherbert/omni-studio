import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  ChevronRight,
  Clock3,
  Film,
  Flag,
  Gauge,
  Loader2,
  Play,
  Pause,
  RotateCcw,
  Save,
  SkipForward,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';

import {
  applyStateEffects,
  buildInteractiveStoryUnits,
  bindingScriptSceneRefs,
  createInitialStateContext,
  evaluatePredicate,
  hasNodeCapability,
  hasCurrentContentFitReview,
  interactiveClient as defaultInteractiveClient,
  nodeRequiresMainContent,
  selectRuntimeMediaScenario,
  type InteractiveRuntimeStoryManifest,
  type InteractiveRuntimeMediaManifest,
  type InteractiveExperienceAggregate,
  type InteractivePlaytestCheckpoint,
  type InteractiveRuntimeBuild,
  type NarrativeNode,
  type RuntimeStateContext,
} from '../clients/interactiveProductionClient';
import { InteractivePlayerServices } from '../components/interactive/InteractivePlayerServices';

const dramaticFunctionLabels = {
  exposition: '故事开始',
  inciting_incident: '事件发生',
  choice_point: '关键选择',
  climax: '高潮',
  resolution: '故事收束',
  ending: '结局',
} as const;

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, '0')}` : `0:${String(remainder).padStart(2, '0')}`;
};

const expectedNodeDuration = (
  node: NarrativeNode,
  storyNode: InteractiveRuntimeStoryManifest['nodes'][number] | undefined,
) => {
  const range = node.interaction?.durationRangeSec;
  if (range && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
    return Math.round((range[0] + range[1]) / 2);
  }
  const sceneSeconds = (storyNode?.scenes || []).reduce(
    (total, scene) => total + Math.max(0, Number(scene.targetDurationSeconds || 0)),
    0,
  );
  if (sceneSeconds > 0) return sceneSeconds;
  return 60;
};

interface PlayedNode {
  nodeId: string;
  choiceText?: string;
}

type SavedNodeState = NonNullable<InteractivePlaytestCheckpoint['state']['nodeStates']>[number];
const savedNodeState = (nodeId: string, context: RuntimeStateContext): SavedNodeState => ({
  nodeId, variables: { ...context.variables }, facts: [...context.facts], visitedNodes: { ...context.visitedNodes },
});
const runtimeNodeState = (state: SavedNodeState): RuntimeStateContext => ({
  variables: { ...state.variables }, facts: new Set(state.facts), visitedNodes: { ...state.visitedNodes },
});

export default function InteractivePlaytestPlayer() {
  const services = useContext(InteractivePlayerServices);
  const interactiveClient = services?.client || defaultInteractiveClient;
  const standalone = Boolean(services?.standalone);
  const { experienceId = '' } = useParams<{ experienceId: string }>();
  const navigate = useNavigate();
  const [aggregate, setAggregate] = useState<InteractiveExperienceAggregate | null>(null);
  const [runtimeBuild, setRuntimeBuild] = useState<InteractiveRuntimeBuild | null>(null);
  const [checkpoint, setCheckpoint] = useState<InteractivePlaytestCheckpoint | null>(null);
  const [runtimeMedia, setRuntimeMedia] = useState<InteractiveRuntimeMediaManifest | null>(null);
  const [runtimeStory, setRuntimeStory] = useState<InteractiveRuntimeStoryManifest | null>(null);
  const [currentNodeId, setCurrentNodeId] = useState('');
  const [runtimeCtx, setRuntimeCtx] = useState<RuntimeStateContext | null>(null);
  const [playedNodes, setPlayedNodes] = useState<PlayedNode[]>([]);
  const [nodeStates, setNodeStates] = useState<SavedNodeState[]>([]);
  const autoSavedVisitRef = useRef('');
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [isCreatingBuild, setIsCreatingBuild] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const buildRequestRef = useRef(0);
  const buildBusyRef = useRef(false);
  const [isLoadingStory, setIsLoadingStory] = useState(false);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [storyError, setStoryError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaLoadError, setMediaLoadError] = useState<string | null>(null);
  const [mediaLoadAttempt, setMediaLoadAttempt] = useState(0);
  const effectiveMediaError = mediaLoadError || mediaError;
  const [sceneIndex, setSceneIndex] = useState(0);
  const [clipIndex, setClipIndex] = useState(0);
  const [storyFinished, setStoryFinished] = useState(false);
  const [mediaFinished, setMediaFinished] = useState(false);
  const [remainingChoiceSeconds, setRemainingChoiceSeconds] = useState<number | null>(null);
  const [isSavingCheckpoint, setIsSavingCheckpoint] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const storyPanelRef = useRef<HTMLElement | null>(null);
  const [storyPanelHeight, setStoryPanelHeight] = useState(220);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [playbackRevision, setPlaybackRevision] = useState(0);

  useEffect(() => {
    let active = true;
    buildRequestRef.current += 1;
    buildBusyRef.current = false;
    setBuildError(null);
    setIsCreatingBuild(false);
    setIsInitialLoadComplete(false);
    setAggregate(null);
    setRuntimeBuild(null);
    setLoadError(null);
    Promise.all([
      interactiveClient.getExperience(experienceId),
      interactiveClient.getLatestRuntimeBuild(experienceId),
    ])
      .then(async ([data, build]) => {
        const savedCheckpoint = build
          ? await interactiveClient.getPlaytestCheckpoint(experienceId, build.id).catch(() => {
            if (active) toast.error('上次的路径暂时无法读取，仍可从头开始试玩。');
            return null;
          })
          : null;
        if (!active) return;
        setAggregate(data);
        setRuntimeBuild(build);
        setCheckpoint(savedCheckpoint);
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error
          ? error.message === 'Interactive experience not found' ? '作品不存在或已被删除。' : error.message
          : '试玩数据读取失败，请稍后重试。');
      })
      .finally(() => {
        if (active) setIsInitialLoadComplete(true);
      });
    return () => { active = false; buildRequestRef.current += 1; };
  }, [experienceId, interactiveClient, loadAttempt]);

  const playbackGraph = runtimeBuild?.status !== 'stale' && runtimeBuild?.graphSnapshot
    ? runtimeBuild.graphSnapshot
    : undefined;
  const playbackStateSchema = runtimeBuild?.status !== 'stale' && runtimeBuild?.stateSchemaSnapshot
    ? runtimeBuild.stateSchemaSnapshot
    : undefined;
  // Older builds predate frozen rules and keep the historical manual-play behavior.
  const playerRules = runtimeBuild?.experienceSpecSnapshot;
  const savePolicy = playerRules?.savePolicy || 'manual_save';
  const failStatePolicy = playerRules?.failStatePolicy || 'retry';
  const timedChoiceOption = playerRules?.accessibilitySettings.timedChoiceOption || 'standard';
  const isHistoricalBuild = Boolean(runtimeBuild && aggregate && (
    runtimeBuild.graphVersionId !== aggregate.graph.id
    || runtimeBuild.stateSchemaVersionId !== aggregate.stateSchema.id
    || JSON.stringify(runtimeBuild.experienceSpecSnapshot) !== JSON.stringify(aggregate.experienceSpec.data)
    || runtimeBuild.nodeManifests.some((manifest) => JSON.stringify(bindingScriptSceneRefs(manifest)) !== JSON.stringify(bindingScriptSceneRefs(aggregate.bindings.find((binding) => binding.nodeId === manifest.nodeId && binding.slot === 'main'))))
    || aggregate.bindings.some((binding) => binding.sourceReview?.status === 'review_recommended')
  ));

  const requiredContentNodes = useMemo(
    () => aggregate?.graph.nodes.filter(nodeRequiresMainContent) || [],
    [aggregate],
  );
  const missingContentNodes = useMemo(
    () => !aggregate ? [] : requiredContentNodes.filter((node) => !aggregate.bindings.some((binding) => (
      binding.nodeId === node.id
      && hasCurrentContentFitReview(binding)
    ))),
    [aggregate, requiredContentNodes],
  );
  const canCreatePreview = Boolean(aggregate?.graph.entryNodeId)
    && Boolean(aggregate?.graph.nodes.length);
  const canCreateFormalBuild = canCreatePreview && missingContentNodes.length === 0;

  const createPreviewBuild = useCallback(async () => {
    if (!canCreatePreview || buildBusyRef.current) return;
    buildBusyRef.current = true;
    const request = ++buildRequestRef.current;
    setIsCreatingBuild(true);
    setBuildError(null);
    try {
      const build = canCreateFormalBuild
        ? await interactiveClient.createRuntimeBuild(experienceId)
        : await interactiveClient.createStructurePreviewBuild(experienceId);
      if (request !== buildRequestRef.current) return;
      setRuntimeBuild(build);
      setCheckpoint(null);
      setRuntimeMedia(null);
      setRuntimeStory(null);
      toast.success(build.kind === 'structure_preview'
        ? '结构试玩已准备好'
        : build.status === 'ready_for_player' ? '完整试玩已准备好' : '剧本试玩已准备好');
    } catch (error) {
      if (request !== buildRequestRef.current) return;
      setBuildError(error instanceof Error ? error.message : '试玩准备失败');
      toast.error(error instanceof Error ? error.message : '试玩准备失败');
    } finally {
      if (request === buildRequestRef.current) {
        buildBusyRef.current = false;
        setIsCreatingBuild(false);
      }
    }
  }, [canCreateFormalBuild, canCreatePreview, experienceId, interactiveClient]);

  useEffect(() => {
    if (
      isInitialLoadComplete
      && aggregate
      && canCreatePreview
      && (!runtimeBuild || runtimeBuild.status === 'stale')
      && !isCreatingBuild
      && !buildError
    ) {
      void createPreviewBuild();
    }
  }, [
    aggregate,
    canCreatePreview,
    createPreviewBuild,
    isCreatingBuild,
    isInitialLoadComplete,
    runtimeBuild,
    buildError,
  ]);

  useEffect(() => {
    if (!playbackGraph || !playbackStateSchema) return;
    const initial = { ...createInitialStateContext(playbackStateSchema), visitedNodes: { [playbackGraph.entryNodeId]: 1 } };
    setCurrentNodeId(playbackGraph.entryNodeId);
    setRuntimeCtx(initial);
    setPlayedNodes([{ nodeId: playbackGraph.entryNodeId }]);
    setNodeStates([savedNodeState(playbackGraph.entryNodeId, initial)]);
    autoSavedVisitRef.current = '';
    setStartedAt(Date.now());
    setElapsedSeconds(0);
  }, [playbackGraph?.id, playbackStateSchema]);

  useEffect(() => {
    if (!startedAt) return;
    const update = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    if (!runtimeBuild || runtimeBuild.status === 'stale') {
      setRuntimeStory(null);
      setStoryError(null);
      setIsLoadingStory(false);
      return;
    }
    let active = true;
    setIsLoadingStory(true);
    setStoryError(null);
    interactiveClient.getRuntimeStoryManifest(experienceId, runtimeBuild.id)
      .then((manifest) => {
        if (active) setRuntimeStory(manifest);
      })
      .catch((error) => {
        if (active) {
          setRuntimeStory(null);
          setStoryError(error instanceof Error ? error.message : '剧本内容读取失败');
        }
      })
      .finally(() => {
        if (active) setIsLoadingStory(false);
      });
    return () => { active = false; };
  }, [experienceId, runtimeBuild?.id, runtimeBuild?.status, interactiveClient]);

  useEffect(() => {
    if (!runtimeBuild || runtimeBuild.status !== 'ready_for_player') {
      setRuntimeMedia(null);
      setMediaLoadError(null);
      setIsLoadingMedia(false);
      return;
    }
    let active = true;
    setIsLoadingMedia(true);
    setMediaLoadError(null);
    interactiveClient.getRuntimeMediaManifest(experienceId, runtimeBuild.id)
      .then((manifest) => {
        if (active) setRuntimeMedia(manifest);
      })
      .catch((error) => {
        if (active) {
          setRuntimeMedia(null);
          setMediaLoadError(error instanceof Error ? error.message : '播放器媒体读取失败');
        }
      })
      .finally(() => {
        if (active) setIsLoadingMedia(false);
      });
    return () => { active = false; };
  }, [experienceId, runtimeBuild?.id, runtimeBuild?.status, interactiveClient, mediaLoadAttempt]);

  const currentNode = useMemo(
    () => playbackGraph?.nodes.find((node) => node.id === currentNodeId),
    [currentNodeId, playbackGraph],
  );
  const currentStoryNode = useMemo(
    () => runtimeStory?.nodes.find((node) => node.nodeId === currentNodeId),
    [currentNodeId, runtimeStory],
  );
  const currentScene = currentStoryNode?.scenes[sceneIndex];
  const currentNodeMedia = useMemo(() => {
    const mediaNode = runtimeMedia?.nodes.find((node) => node.nodeId === currentNodeId);
    if (!mediaNode?.scenarios?.length || !runtimeCtx) return mediaNode?.clips || [];
    const scenario = selectRuntimeMediaScenario(mediaNode.scenarios, runtimeCtx);
    return scenario?.clips || [];
  }, [currentNodeId, runtimeCtx, runtimeMedia]);
  const storyMedia = useMemo(
    () => currentNodeMedia.filter((clip) => clip.contentSlot !== 'choice_hold'),
    [currentNodeMedia],
  );
  const choiceHoldClip = useMemo(
    () => currentNodeMedia.find((clip) => clip.contentSlot === 'choice_hold'),
    [currentNodeMedia],
  );
  const activeStoryClip = storyMedia[clipIndex];
  const hasStoryMedia = Boolean(activeStoryClip && !effectiveMediaError);
  const isMediaDecisionPending = runtimeBuild?.status === 'ready_for_player'
    && !runtimeMedia
    && !effectiveMediaError;

  const resetNodePlayback = useCallback(() => {
    setPlaybackRevision((revision) => revision + 1);
    setIsVideoPlaying(false);
    setSceneIndex(0);
    setClipIndex(0);
    setStoryFinished(false);
    setMediaFinished(false);
    setMediaError(null);
  }, []);

  useEffect(() => {
    resetNodePlayback();
  }, [currentNodeId, resetNodePlayback, runtimeMedia?.buildId, runtimeStory?.buildId]);

  useEffect(() => {
    if (!runtimeStory || !currentNode) return;
    if (!currentStoryNode?.scenes.length && !storyFinished) setStoryFinished(true);
  }, [currentNode, currentStoryNode, runtimeStory, storyFinished]);

  const unlockedChoices = useMemo(
    () => currentNode?.choices.filter((choice) => (
      !choice.condition || (runtimeCtx && evaluatePredicate(choice.condition, runtimeCtx))
    )) || [],
    [currentNode, runtimeCtx],
  );
  const timedChoice = useMemo(() => {
    if (timedChoiceOption === 'infinite') return null;
    const configured = unlockedChoices.filter((choice) => (
      Number.isFinite(choice.timeoutSeconds)
      && (choice.timeoutSeconds || 0) > 0
      && Boolean(choice.defaultTimeoutTargetNodeId)
    ));
    if (!configured.length) return null;
    const first = configured[0];
    const isConsistent = configured.every((choice) => (
      choice.timeoutSeconds === first.timeoutSeconds
      && choice.defaultTimeoutTargetNodeId === first.defaultTimeoutTargetNodeId
    ));
    return isConsistent ? {
      seconds: first.timeoutSeconds! * (timedChoiceOption === 'extended' ? 2 : 1),
      defaultTargetNodeId: first.defaultTimeoutTargetNodeId!,
    } : null;
  }, [unlockedChoices, timedChoiceOption]);
  const choicePhaseReady = !isLoadingStory
    && !isMediaDecisionPending
    && (hasStoryMedia ? mediaFinished : storyFinished);
  const displayedClip = choicePhaseReady && choiceHoldClip && !effectiveMediaError
    ? choiceHoldClip
    : activeStoryClip;
  const hasPlayableMedia = Boolean(displayedClip && !effectiveMediaError);
  const isChoiceHoldPlaying = displayedClip?.contentSlot === 'choice_hold';

  useEffect(() => {
    const panel = storyPanelRef.current;
    if (!panel || !hasPlayableMedia) return;
    const observer = new ResizeObserver(() => setStoryPanelHeight(panel.getBoundingClientRect().height));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [currentNodeId, hasPlayableMedia, choicePhaseReady]);

  const continueMedia = useCallback(() => {
    if (clipIndex + 1 < storyMedia.length) {
      setClipIndex((index) => index + 1);
      return;
    }
    setMediaFinished(true);
  }, [clipIndex, storyMedia.length]);

  const advanceTo = useCallback((
    targetNodeId: string,
    effects: Parameters<typeof applyStateEffects>[0],
    choiceText: string,
  ) => {
    if (!playbackStateSchema || !runtimeCtx) return;
    const nextContext = applyStateEffects(effects, runtimeCtx, playbackStateSchema);
    const enteredContext = {
      ...nextContext,
      visitedNodes: {
        ...nextContext.visitedNodes,
        [targetNodeId]: (nextContext.visitedNodes[targetNodeId] || 0) + 1,
      },
    };
    setRuntimeCtx(enteredContext);
    setNodeStates((current) => [...current, savedNodeState(targetNodeId, enteredContext)]);
    setPlayedNodes((current) => [
      ...current.map((entry, index) => index === current.length - 1 ? { ...entry, choiceText } : entry),
      { nodeId: targetNodeId },
    ]);
    // A legal loop may target the current node, so resetting cannot rely only on
    // the currentNodeId effect. Every visit must replay its story/media from 0.
    resetNodePlayback();
    setCurrentNodeId(targetNodeId);
  }, [currentNodeId, playbackStateSchema, resetNodePlayback, runtimeCtx]);

  useEffect(() => {
    if (!playbackGraph || !runtimeCtx || !choicePhaseReady || !timedChoice) {
      setRemainingChoiceSeconds(null);
      return;
    }
    const deadline = Date.now() + timedChoice.seconds * 1000;
    const updateRemaining = () => setRemainingChoiceSeconds(
      Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
    );
    updateRemaining();
    const ticker = window.setInterval(updateRemaining, 250);
    const timeout = window.setTimeout(() => {
      advanceTo(timedChoice.defaultTargetNodeId, [], '未在时限内选择');
    }, timedChoice.seconds * 1000);
    return () => {
      window.clearInterval(ticker);
      window.clearTimeout(timeout);
    };
  }, [advanceTo, choicePhaseReady, playbackGraph, runtimeCtx, timedChoice]);

  useEffect(() => {
    if (!choicePhaseReady || !unlockedChoices.length) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1;
      const choice = unlockedChoices[index];
      if (!choice) return;
      advanceTo(choice.targetNodeId, choice.effects, choice.text);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [advanceTo, choicePhaseReady, unlockedChoices]);

  const restart = () => {
    if (!playbackGraph || !playbackStateSchema) return;
    autoSavedVisitRef.current = 'restart';
    const initial = { ...createInitialStateContext(playbackStateSchema), visitedNodes: { [playbackGraph.entryNodeId]: 1 } };
    setCurrentNodeId(playbackGraph.entryNodeId);
    setRuntimeCtx(initial);
    setPlayedNodes([{ nodeId: playbackGraph.entryNodeId }]);
    setNodeStates([savedNodeState(playbackGraph.entryNodeId, initial)]);
    setStartedAt(Date.now());
    setElapsedSeconds(0);
    resetNodePlayback();
  };

  const returnToPreviousState = (rollback: boolean) => {
    if (nodeStates.length < 2 || !playbackGraph) { restart(); return; }
    let index = nodeStates.length - 2;
    if (rollback) {
      for (let candidate = index; candidate >= 0; candidate--) {
        const node = playbackGraph.nodes.find((item) => item.id === nodeStates[candidate].nodeId);
        if (node && hasNodeCapability(node, 'checkpoint')) { index = candidate; break; }
      }
    }
    const state = nodeStates[index];
    setCurrentNodeId(state.nodeId);
    setRuntimeCtx(runtimeNodeState(state));
    setNodeStates(nodeStates.slice(0, index + 1));
    setPlayedNodes(playedNodes.slice(0, index + 1));
    resetNodePlayback();
  };

  const persistCheckpoint = useCallback((nodeId: string, context: RuntimeStateContext, path: PlayedNode[], history: SavedNodeState[]) => {
    if (!runtimeBuild || !playbackStateSchema) return Promise.reject(new Error('试玩尚未准备好'));
    const operation = () => interactiveClient.savePlaytestCheckpoint(experienceId, {
        runtimeBuildId: runtimeBuild.id,
        currentNodeId: nodeId,
        state: {
          variables: context.variables,
          facts: Array.from(context.facts),
          visitedNodes: context.visitedNodes,
          playedNodes: path,
          elapsedSeconds,
          nodeStates: history,
        },
      });
    const pending = saveQueueRef.current.then(operation, operation);
    saveQueueRef.current = pending.catch(() => undefined);
    return pending;
  }, [elapsedSeconds, experienceId, interactiveClient, playbackStateSchema, runtimeBuild]);

  const saveCheckpoint = async () => {
    if (!runtimeCtx) return;
    setIsSavingCheckpoint(true);
    try {
      const saved = await persistCheckpoint(currentNodeId, runtimeCtx, playedNodes, nodeStates);
      setCheckpoint(saved);
      toast.success('当前路径已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '路径保存失败');
    } finally {
      setIsSavingCheckpoint(false);
    }
  };

  useEffect(() => {
    if (!runtimeBuild || !playbackGraph || !runtimeCtx || !currentNodeId || !playedNodes.length) return;
    if (savePolicy === 'manual_save') return;
    // Loading a saved path must not overwrite it with the entry state before
    // the author gets a chance to restore it.
    if (playedNodes.length === 1 && checkpoint?.runtimeBuildId === runtimeBuild.id && autoSavedVisitRef.current !== 'restart') return;
    const node = playbackGraph.nodes.find((item) => item.id === currentNodeId);
    if (!node || hasNodeCapability(node, 'fail_or_retry')) return;
    const visitKey = `${runtimeBuild.id}:${playedNodes.length}:${currentNodeId}`;
    if (autoSavedVisitRef.current === visitKey) return;
    const previousNodeId = playedNodes.at(-2)?.nodeId;
    const enteringChapter = Boolean(runtimeBuild.nodeChapterIds?.[currentNodeId]
      && runtimeBuild.nodeChapterIds[currentNodeId] !== runtimeBuild.nodeChapterIds?.[previousNodeId || '']);
    if (savePolicy === 'chapter_only' && playedNodes.length !== 1 && !hasNodeCapability(node, 'checkpoint') && !enteringChapter) return;
    autoSavedVisitRef.current = visitKey;
    void persistCheckpoint(currentNodeId, runtimeCtx, playedNodes, nodeStates)
      .then(setCheckpoint)
      .catch(() => { autoSavedVisitRef.current = ''; });
  }, [checkpoint?.runtimeBuildId, currentNodeId, nodeStates, persistCheckpoint, playbackGraph, playedNodes, runtimeBuild, runtimeCtx, savePolicy]);

  const isCheckpointCompatible = Boolean(
    checkpoint
      && checkpoint.graphVersionId === playbackGraph?.id
      && checkpoint.stateSchemaVersionId === runtimeBuild?.stateSchemaVersionId
      && playbackGraph?.nodes.some((node) => node.id === checkpoint.currentNodeId)
      && (!checkpoint.runtimeBuildId || checkpoint.runtimeBuildId === runtimeBuild?.id),
  );
  const restoreCheckpoint = () => {
    if (!checkpoint || !isCheckpointCompatible) return;
    setCurrentNodeId(checkpoint.currentNodeId);
    setRuntimeCtx({
      variables: checkpoint.state.variables,
      facts: new Set(checkpoint.state.facts),
      visitedNodes: checkpoint.state.visitedNodes,
    });
    setPlayedNodes(checkpoint.state.playedNodes?.length
      ? checkpoint.state.playedNodes
      : [{ nodeId: checkpoint.currentNodeId }]);
    setNodeStates(checkpoint.state.nodeStates?.length
      ? checkpoint.state.nodeStates
      : [savedNodeState(checkpoint.currentNodeId, {
          variables: checkpoint.state.variables,
          facts: new Set(checkpoint.state.facts),
          visitedNodes: checkpoint.state.visitedNodes,
        })]);
    const restoredElapsed = Math.max(0, checkpoint.state.elapsedSeconds || 0);
    setStartedAt(Date.now() - restoredElapsed * 1000);
    setElapsedSeconds(restoredElapsed);
    resetNodePlayback();
    toast.success('已恢复上次保存的路径');
  };
  const recoverFailure = () => {
    if (failStatePolicy === 'game_over') { restart(); return; }
    if (failStatePolicy === 'checkpoint') {
      if (isCheckpointCompatible) restoreCheckpoint(); else restart();
      return;
    }
    returnToPreviousState(failStatePolicy === 'rollback');
  };

  const storyUnits = useMemo(
    () => buildInteractiveStoryUnits(aggregate?.storyArchitecture.data || null, playbackGraph || null),
    [aggregate?.storyArchitecture.data, playbackGraph],
  );
  const activeStoryUnit = storyUnits.find((unit) => unit.nodeIds.includes(currentNodeId));
  const storyScope = activeStoryUnit
    ? [
      activeStoryUnit.episodeTitle,
      `第${activeStoryUnit.order}章`,
      activeStoryUnit.title.replace(/^第[一二三四五六七八九十百\d]+章[：:]\s*/, ''),
    ].filter(Boolean).join(' · ')
    : '';
  const expectedPlayedSeconds = playbackGraph
    ? playedNodes.reduce((total, entry) => {
      const node = playbackGraph.nodes.find((candidate) => candidate.id === entry.nodeId);
      const storyNode = runtimeStory?.nodes.find((candidate) => candidate.nodeId === entry.nodeId);
      return total + (node ? expectedNodeDuration(node, storyNode) : 0);
    }, 0)
    : 0;
  const currentNodeExpectedSeconds = currentNode
    ? expectedNodeDuration(currentNode, currentStoryNode)
    : 0;
  const isEnding = Boolean(
    currentNode?.brief.dramaticFunction === 'ending'
    || (currentNode && hasNodeCapability(currentNode, 'terminal')),
  );
  const isFailure = Boolean(currentNode && hasNodeCapability(currentNode, 'fail_or_retry'));
  const firstMissingContentNodeId = missingContentNodes[0]?.id;
  const writingProjectId = aggregate?.experience.storySource.writingProjectId;
  const contentHandoff = writingProjectId
    ? `/writing?projectId=${encodeURIComponent(writingProjectId)}&returnTo=${encodeURIComponent(
      `/interactive/experiences/${experienceId}/graph${firstMissingContentNodeId ? `?nodeId=${encodeURIComponent(firstMissingContentNodeId)}` : ''}`,
    )}`
    : `/interactive/experiences/${experienceId}/graph${firstMissingContentNodeId ? `?nodeId=${encodeURIComponent(firstMissingContentNodeId)}` : ''}`;
  const mediaHandoffNodeId = currentNode?.id ?? runtimeBuild?.missingMediaNodeIds[0] ?? runtimeBuild?.pendingMediaReviewNodeIds[0];
  const productionHandoff = `/interactive/experiences/${experienceId}/production${mediaHandoffNodeId ? `?nodeId=${encodeURIComponent(mediaHandoffNodeId)}` : ''}`;
  const previousVisitedNodeId = playedNodes.at(-2)?.nodeId || '';
  const isChapterBoundary = Boolean(runtimeBuild?.nodeChapterIds?.[currentNodeId]
    && runtimeBuild.nodeChapterIds[currentNodeId] !== runtimeBuild.nodeChapterIds[previousVisitedNodeId]);
  const canSaveCheckpoint = Boolean(runtimeBuild && runtimeBuild.status !== 'stale' && playbackGraph && playbackStateSchema
    && !isFailure && (savePolicy !== 'chapter_only' || playedNodes.length === 1 || isChapterBoundary || (currentNode && hasNodeCapability(currentNode, 'checkpoint'))));
  const canExport = Boolean(runtimeBuild && runtimeBuild.status !== 'stale' && playbackGraph && playbackStateSchema);

  const continueStory = () => {
    if (!currentStoryNode || sceneIndex + 1 >= currentStoryNode.scenes.length) {
      setStoryFinished(true);
      return;
    }
    setSceneIndex((index) => index + 1);
  };

  const exportPlayable = async () => {
    if (!runtimeBuild || isExporting) return;
    setIsExporting(true);
    try {
      const response = await fetch(`/api/interactive/experiences/${encodeURIComponent(experienceId)}/runtime-export?runtimeBuildId=${encodeURIComponent(runtimeBuild.id)}`);
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.error || '可玩文件导出失败');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${aggregate?.experience.title || '互动作品'}.html`.replace(/[\\/:*?"<>|]/g, '-');
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success('可玩文件已生成，已发起下载');
    } catch (error) { toast.error(error instanceof Error ? error.message : '导出失败'); }
    finally { setIsExporting(false); }
  };

  if (loadError && isInitialLoadComplete) return (
    <div role="alert" className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-4 bg-bg-primary p-8 text-text-primary">
      <h1 className="text-xl font-semibold">无法打开互动作品</h1>
      <p className="max-w-xl break-words text-sm">{loadError}</p>
      <div className="flex gap-4">
        <button className="rounded-md border px-4 py-2" onClick={() => setLoadAttempt((value) => value + 1)}>重试</button>
        {!standalone && <button className="rounded-md border px-4 py-2" onClick={() => navigate('/interactive')}>返回作品列表</button>}
      </div>
    </div>
  );

  if (!aggregate || !isInitialLoadComplete) {
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-bg-primary text-text-primary">
        <Loader2 className="h-7 w-7 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1000] flex min-h-0 flex-col overflow-hidden bg-bg-primary text-text-primary transition-colors duration-200">
      <header className="relative z-40 flex h-16 shrink-0 items-center justify-between border-b border-border-soft/30 bg-bg-surface px-4 sm:px-6 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {!standalone && <button
            type="button"
            onClick={() => navigate(`/interactive/experiences/${experienceId}/graph`)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-soft/40 bg-bg-surface-soft text-text-muted hover:bg-bg-surface-hover hover:text-text-primary transition-colors"
            title="返回节点白板"
            aria-label="返回节点白板"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-extrabold text-text-primary">{aggregate.experience.title}</h1>
            <p className="truncate text-[11px] font-medium text-text-muted">
              {isHistoricalBuild ? '来源有更新 · 历史试玩快照' : standalone ? '互动作品' : '互动作品试玩'} · {runtimeBuild?.kind === 'structure_preview'
                ? '结构试玩'
                : effectiveMediaError ? '文字预览 · 画面不可用' : runtimeBuild?.status === 'ready_for_player' ? '成片画面' : '剧本画面'}
            </p>
            {Boolean(runtimeBuild?.qaWarnings?.length) && <p className="truncate text-[11px] text-amber-500" title={runtimeBuild?.qaWarnings?.join('；')}>
              检查提示 {runtimeBuild?.qaWarnings?.length} 项 · {runtimeBuild?.qaWarnings?.[0]}
            </p>}
          </div>
        </div>

        {!standalone && <div className="hidden items-center gap-6 text-xs font-bold text-text-muted md:flex">
          <span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-gold" /> 试玩用时 {formatDuration(elapsedSeconds)}</span>
          <span className="flex items-center gap-2"><Gauge className="h-4 w-4 text-gold" /> 当前路径约 {formatDuration(expectedPlayedSeconds)}</span>
          <span>已走过 {playedNodes.length} 段</span>
        </div>}

        <div className="flex items-center gap-2">
          {!standalone && <button type="button" onClick={() => void exportPlayable()}
            disabled={!canExport || isExporting} title="导出可玩文件" aria-label="导出可玩文件"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border-soft/40 bg-bg-surface-soft text-text-muted disabled:opacity-30">
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </button>}
          {checkpoint && (
            <button
              type="button"
              onClick={restoreCheckpoint}
              disabled={!isCheckpointCompatible}
              title={isCheckpointCompatible ? '恢复路径' : '上次保存的路径对应旧内容'}
              aria-label="恢复路径"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-soft/40 bg-bg-surface-soft text-text-muted hover:bg-bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors"
            >
              <Play className="h-4 w-4 fill-current" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveCheckpoint()}
            disabled={isSavingCheckpoint || !canSaveCheckpoint}
            title="保存路径"
            aria-label="保存路径"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-soft/40 bg-bg-surface-soft text-text-muted hover:bg-bg-surface-hover hover:text-text-primary disabled:opacity-30 transition-colors"
          >
            {isSavingCheckpoint ? <Loader2 className="h-4 w-4 animate-spin text-gold" /> : <Save className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={restart}
            disabled={!playbackGraph || !playbackStateSchema}
            title="重新开始"
            aria-label="重新开始"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-soft/40 bg-bg-surface-soft text-text-muted hover:bg-bg-surface-hover hover:text-text-primary disabled:opacity-30 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {!standalone && (isHistoricalBuild || (runtimeBuild?.kind === 'structure_preview' && canCreateFormalBuild)) && <section className="relative z-30 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-bg-surface px-6 py-3 text-xs text-text-primary">
        <p>当前显示已保存的试玩快照。可使用最新故事、规则与已确认剧本重新开始。</p>
        <button type="button" disabled={isCreatingBuild} onClick={() => void createPreviewBuild()} className="shrink-0 rounded-xl border border-border-soft/40 px-3 py-2 font-bold text-gold disabled:opacity-40">{isCreatingBuild ? '正在准备当前内容…' : '用当前内容重新准备'}</button>
      </section>}

      {effectiveMediaError && <section role="alert" className="relative z-30 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-bg-surface px-6 py-3 text-sm text-text-primary">
        <p className="min-w-0 flex-1 basis-96 break-words">{effectiveMediaError}</p>
        <div className="flex flex-wrap items-center gap-3">
          {!standalone && mediaLoadError && <button type="button" disabled={isLoadingMedia} onClick={() => setMediaLoadAttempt((attempt) => attempt + 1)} className="inline-flex items-center gap-2 text-sm underline underline-offset-4 disabled:opacity-40"><RotateCcw className="h-4 w-4" />重试读取</button>}
          {!standalone && <button type="button" disabled={isCreatingBuild} onClick={() => void createPreviewBuild()} className="inline-flex items-center gap-2 text-sm underline underline-offset-4 disabled:opacity-40"><Play className="h-4 w-4" />用当前内容重新准备</button>}
          {!standalone && <button type="button" onClick={() => navigate(productionHandoff)} className="text-sm underline underline-offset-4">检查素材</button>}
        </div>
      </section>}

      <main className="relative min-h-0 flex-1 overflow-hidden bg-bg-primary">
        {buildError && <div role="alert" className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-4 border-b border-amber-300 bg-bg-surface p-4 text-sm text-text-primary">
          <span className="max-w-2xl break-words">{buildError}</span>
          <button className="shrink-0 underline" disabled={isCreatingBuild} onClick={() => void createPreviewBuild()}>重试</button>
        </div>}
        {!currentNode ? (
          <section className="flex h-full items-center justify-center px-5">
            <div className="w-full max-w-lg border border-border-soft/40 bg-bg-surface p-8 text-center rounded-2xl shadow-2xl backdrop-blur-xl sm:p-10">
              {isCreatingBuild ? (
                <>
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-gold" />
                  <h2 className="mt-5 text-xl font-bold text-text-primary">正在进入故事</h2>
                  <p className="mt-2 text-xs text-text-muted">系统会自动整理当前故事并准备体验。</p>
                </>
              ) : missingContentNodes.length > 0 ? (
                <>
                  <Film className="mx-auto h-10 w-10 text-amber-500" />
                  <h2 className="mt-5 text-xl font-bold text-text-primary">先试玩故事结构</h2>
                  <p className="mt-2 text-xs leading-6 text-text-muted">
                    还有 {missingContentNodes.length} 个节点缺少完整剧本；结构试玩会使用节点摘要，不代表成片。
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => void createPreviewBuild()}
                      className="rounded-xl bg-gold px-6 py-3 text-xs font-bold text-bg-primary shadow-md shadow-gold/20 hover:bg-gold-light transition-all"
                    >
                      开始结构试玩
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(contentHandoff)}
                      className="rounded-xl border border-border-soft/40 bg-bg-surface-soft px-5 py-3 text-xs font-bold text-text-primary hover:bg-bg-surface-hover transition-colors"
                    >
                      继续完善内容
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Play className="mx-auto h-10 w-10 text-gold fill-current" />
                  <h2 className="mt-5 text-xl font-bold text-text-primary">互动游戏试玩</h2>
                  <p className="mt-2 text-xs leading-6 text-text-muted">
                    {runtimeBuild?.status === 'stale'
                      ? runtimeBuild.staleReason || '内容已更新，请重新开始试玩。'
                      : '没有图片和视频时使用正式剧本画面；补齐画面后即可完整播放。'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void createPreviewBuild()}
                    disabled={!canCreatePreview}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gold px-6 py-3 text-xs font-bold text-bg-primary shadow-md shadow-gold/20 hover:bg-gold-light transition-all disabled:opacity-30"
                  >
                    <Play className="h-4 w-4 fill-current" /> 开始试玩
                  </button>
                </>
              )}
            </div>
          </section>
        ) : (
          <>
            <div className="absolute inset-x-0 top-0 overflow-hidden bg-bg-primary" style={{ bottom: hasPlayableMedia ? storyPanelHeight : 0 }}>
              {hasPlayableMedia ? (
                displayedClip!.mediaKind === 'image' ? (
                  <img
                    key={`${playbackRevision}:${clipIndex}:${displayedClip!.url}`}
                    src={displayedClip!.url}
                    alt=""
                    className="h-full w-full object-contain"
                    onError={() => {
                      setMediaFinished(false);
                      setMediaError(`“${currentNode.brief.title}”的画面无法显示，已切换为剧本试玩。`);
                    }}
                  />
                ) : (
                  <video
                    key={`${playbackRevision}:${clipIndex}:${displayedClip!.url}`}
                    ref={videoRef}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    loop={isChoiceHoldPlaying}
                    className="h-full w-full object-contain"
                    src={displayedClip!.url}
                    onPlay={() => setIsVideoPlaying(true)}
                    onPause={() => setIsVideoPlaying(false)}
                    onLoadedMetadata={() => setIsVideoPlaying(!videoRef.current?.paused)}
                    onEnded={isChoiceHoldPlaying ? undefined : continueMedia}
                    onError={() => {
                      setMediaFinished(false);
                      setMediaError(`“${currentNode.brief.title}”的画面无法播放，已切换为剧本试玩。`);
                    }}
                  >
                    当前浏览器无法播放这段视频。
                  </video>
                )
              ) : null}
            </div>

            <div className={`pointer-events-none absolute inset-0 ${hasPlayableMedia ? 'bg-black/30' : 'bg-bg-primary/40'}`} />

            <div className={`pointer-events-none relative z-10 flex h-full flex-col ${hasPlayableMedia ? '' : 'overflow-y-auto'}`}>
              <div className="pointer-events-auto flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-8">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-gold">{storyScope || dramaticFunctionLabels[currentNode.brief.dramaticFunction]}</p>
                  {!standalone && <p className="mt-0.5 truncate text-[11px] text-text-muted">
                    {dramaticFunctionLabels[currentNode.brief.dramaticFunction]} · 本节点约 {formatDuration(currentNodeExpectedSeconds)}
                  </p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {hasPlayableMedia && displayedClip?.mediaKind === 'video' && <button
                    type="button" title={isVideoPlaying ? '暂停画面' : '播放画面'} aria-label={isVideoPlaying ? '暂停画面' : '播放画面'}
                    onClick={() => {
                      const video = videoRef.current;
                      if (!video) return;
                      if (!video.paused) video.pause();
                      else void video.play().catch(() => toast.error('视频暂时无法播放，可以稍后重试或跳过画面。'));
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-border-soft/40 bg-bg-surface text-text-primary">
                    {isVideoPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>}
                  {isLoadingMedia && (
                    <span className="hidden items-center gap-2 text-xs font-bold text-text-muted sm:flex">
                      <Loader2 className="h-4 w-4 animate-spin text-gold" /> 正在准备成片
                    </span>
                  )}
                  {!standalone && runtimeBuild?.status === 'waiting_for_media' && (
                    <button
                      type="button"
                      onClick={() => navigate(productionHandoff)}
                      className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-bold text-gold hover:bg-gold/20 transition-colors"
                    >
                      制作画面
                    </button>
                  )}
                  {hasStoryMedia && !mediaFinished && (
                    <button
                      type="button"
                      onClick={continueMedia}
                      className="flex items-center gap-2 rounded-xl border border-border-soft/40 bg-bg-surface px-4 py-2 text-xs font-bold text-text-primary hover:bg-bg-surface-soft transition-colors"
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      {clipIndex + 1 < storyMedia.length ? '下一画面' : isEnding ? '查看结局' : '进入选择'}
                    </button>
                  )}
                </div>
              </div>

              {hasPlayableMedia && <div className="min-h-0 flex-1" />}

              <section ref={storyPanelRef} className={hasPlayableMedia
                ? 'pointer-events-auto relative shrink-0 border-t border-border-soft/30 bg-bg-surface/95 px-8 py-6 backdrop-blur-xl'
                : 'pointer-events-auto relative my-auto w-full max-w-4xl self-center px-8 py-12'}>
                {!choicePhaseReady ? (
                  <div className={`mx-auto flex max-w-6xl flex-col gap-6 ${hasPlayableMedia ? 'lg:flex-row lg:items-end lg:justify-between' : 'items-start'}`}>
                    <div className="min-w-0 max-w-3xl">
                      <div className="flex items-center gap-3 text-xs font-bold text-gold">
                        <span>{currentScene ? `场 ${currentScene.sceneIndex}` : dramaticFunctionLabels[currentNode.brief.dramaticFunction]}</span>
                        {currentStoryNode && currentStoryNode.scenes.length > 1 && (
                          <span className="text-text-muted">{sceneIndex + 1} / {currentStoryNode.scenes.length}</span>
                        )}
                      </div>
                      <h2 className="mt-2 text-xl font-extrabold text-text-primary sm:text-2xl">{currentScene?.sceneTitle || currentNode.brief.title}</h2>
                      <div className={`${hasPlayableMedia ? 'max-h-[30vh]' : 'max-h-[48vh]'} mt-5 overflow-y-auto pr-3 text-base leading-8 text-text-secondary`}>
                        {isLoadingStory ? (
                          <p className="flex items-center gap-2 text-text-muted"><Loader2 className="h-4 w-4 animate-spin text-gold" /> 正在读取剧本</p>
                        ) : isMediaDecisionPending ? (
                          <p className="flex items-center gap-2 text-text-muted"><Loader2 className="h-4 w-4 animate-spin text-gold" /> 正在读取成片</p>
                        ) : storyError ? (
                          <p className="text-amber-500 font-bold">{storyError}</p>
                        ) : hasStoryMedia ? (
                          <p className="text-text-muted">
                            画面 {clipIndex + 1}/{storyMedia.length} · 播放完毕后显示选择
                          </p>
                        ) : currentScene?.scriptBlocks?.length ? (
                          <div className="space-y-3">
                            {(currentScene.scriptBlocks || []).map((block, index) => {
                              if (block.type === 'character') {
                                return <p key={`${block.type}-${index}`} className="pt-1 text-xs font-bold text-gold uppercase tracking-wider">{block.content}</p>;
                              }
                              if (block.type === 'dialogue') {
                                return <p key={`${block.type}-${index}`} className="pl-4 border-l-2 border-gold/40 text-sm leading-7 text-text-primary font-medium">{block.content}</p>;
                              }
                              if (block.type === 'scene_heading') {
                                return <p key={`${block.type}-${index}`} className="text-xs font-bold text-text-muted">{block.content}</p>;
                              }
                              return <p key={`${block.type}-${index}`} className="text-base leading-8 text-text-secondary">{block.content}</p>;
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-text-muted leading-6">{currentScene?.synopsis || currentNode.brief.narrativeSummary || currentNode.brief.intent}</p>
                        )}
                      </div>
                    </div>
                    {!hasStoryMedia && !isLoadingStory && !isMediaDecisionPending && (
                      <button
                        type="button"
                        onClick={continueStory}
                        className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-gold px-6 text-sm font-bold text-bg-primary shadow-md shadow-gold/20 hover:bg-gold-light transition-all active:scale-95"
                      >
                        {currentStoryNode && sceneIndex + 1 < currentStoryNode.scenes.length
                          ? '下一场'
                          : isEnding ? '查看结局' : '进入选择'}
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ) : isFailure ? (
                  <div className="mx-auto max-w-3xl py-3 text-center">
                    <Flag className="mx-auto h-8 w-8 text-amber-500" />
                    <h2 className="mt-3 text-2xl font-bold text-text-primary">{currentNode.brief.title}</h2>
                    <p className="mx-auto mt-3 max-w-2xl text-sm text-text-muted">{currentNode.brief.narrativeSummary || '这条路径暂时无法继续。'}</p>
                    <button type="button" onClick={recoverFailure}
                      className="mt-6 rounded-xl bg-gold px-6 py-3 text-xs font-bold text-bg-primary">
                      {failStatePolicy === 'game_over' ? '重新开始'
                        : failStatePolicy === 'checkpoint' ? '返回存档'
                          : failStatePolicy === 'rollback' ? '回到检查点' : '重试选择'}
                    </button>
                  </div>
                ) : isEnding ? (
                  <div className="mx-auto max-w-3xl py-3 text-center">
                    <Flag className="mx-auto h-8 w-8 text-gold" />
                    <p className="mt-3 text-xs font-bold text-gold">{storyScope}</p>
                    <h2 className="mt-2 text-3xl font-extrabold text-text-primary">{currentNode.brief.title}</h2>
                    <p className="mx-auto mt-3 max-w-2xl text-xs leading-6 text-text-muted">
                      {currentScene?.synopsis || currentNode.brief.narrativeSummary || currentNode.brief.intent}
                    </p>
                    {!standalone && <div className="mt-5 flex flex-wrap items-center justify-center gap-5 text-xs font-medium text-text-muted">
                      <span>经过 {playedNodes.length} 个节点</span>
                      <span>预计路径 {formatDuration(expectedPlayedSeconds)}</span>
                      <span>试玩用时 {formatDuration(elapsedSeconds)}</span>
                    </div>}
                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                      <button
                        type="button"
                        onClick={restart}
                        className="flex items-center gap-2 rounded-xl bg-gold px-6 py-3 text-xs font-bold text-bg-primary shadow-md shadow-gold/20 hover:bg-gold-light transition-all"
                      >
                        <RotateCcw className="h-4 w-4" /> 重新试玩
                      </button>
                      {!standalone && <button
                        type="button"
                        onClick={() => navigate(`/interactive/experiences/${experienceId}/graph`)}
                        className="rounded-xl border border-border-soft/40 bg-bg-surface-soft px-6 py-3 text-xs font-bold text-text-primary hover:bg-bg-surface-hover transition-colors"
                      >
                        返回节点白板
                      </button>}
                    </div>
                  </div>
                ) : unlockedChoices.length ? (
                  <div className="mx-auto max-w-6xl">
                    <div className="mb-4 flex items-end justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold text-gold">{storyScope}</p>
                        <h2 className="mt-1 text-xl font-extrabold text-text-primary">{currentNode.brief.title}</h2>
                      </div>
                      {timedChoice && (
                        <div className="text-right">
                          <p className="text-xs font-bold text-amber-500">请在限定时间内做出选择</p>
                          <p className="mt-1 text-xl font-extrabold text-amber-500">{remainingChoiceSeconds ?? timedChoice.seconds} 秒</p>
                        </div>
                      )}
                    </div>
                    <div className={`grid gap-3 ${unlockedChoices.length > 2 ? 'md:grid-cols-2' : ''}`}>
                      {unlockedChoices.map((choice, index) => (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => advanceTo(choice.targetNodeId, choice.effects, choice.text)}
                          className="group flex min-h-14 items-center gap-4 rounded-xl border border-border-soft/40 bg-bg-surface-soft/60 dark:bg-neutral-950/60 px-4 py-3.5 text-left hover:border-gold/60 hover:bg-gold/10 transition-all cursor-pointer shadow-sm hover:shadow-md"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-soft/40 bg-bg-surface text-xs font-bold text-text-muted group-hover:border-gold/50 group-hover:text-gold transition-colors">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1 text-base font-medium text-text-primary">{choice.text}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-text-muted group-hover:text-gold transition-colors" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-xl py-4 text-center">
                    <p className="text-sm font-bold text-amber-500">这里没有可用选择</p>
                    <p className="mt-2 text-xs leading-6 text-text-muted">{standalone ? '这条路径暂时无法继续，可以重新开始，或恢复之前保存的路径。' : '可以返回节点白板修改选项和条件，或重新开始体验其他路径。'}</p>
                    <button
                      type="button"
                      onClick={() => standalone ? restart() : navigate(`/interactive/experiences/${experienceId}/graph?nodeId=${encodeURIComponent(currentNode.id)}`)}
                      className="mt-4 rounded-xl border border-border-soft/40 bg-bg-surface-soft px-5 py-2.5 text-xs font-bold text-text-primary hover:bg-bg-surface-hover transition-colors"
                    >
                      {standalone ? '重新开始' : '返回当前节点'}
                    </button>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      {checkpoint && !isCheckpointCompatible && (
        <div className="absolute bottom-3 left-3 z-50 rounded-xl border border-amber-500/30 bg-bg-surface px-4 py-2.5 text-xs font-bold text-amber-500 shadow-xl backdrop-blur-xl">
          上次保存的路径对应旧内容，已保留记录但不能恢复。
        </div>
      )}
    </div>
  );
}
