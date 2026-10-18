import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Clapperboard, FileText, Loader2, Play, Sparkles, Video } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';

import {
  bindingMediaTakeRefs,
  bindingNeedsContentReview,
  bindingNeedsMediaReview,
  bindingScriptSceneRefs,
  buildInteractiveStoryUnits,
  hasCurrentContentFitReview,
  interactiveClient,
  nodeRequiresMainContent,
  type InteractiveExperienceAggregate,
  type InteractiveProductionMediaTakeOption,
  type InteractiveProductionPrepTarget,
  type InteractiveRuntimeBuild,
  type InteractiveWritingSceneOption,
  type NarrativeNode,
} from '../clients/interactiveProductionClient';

const scenesForBinding = (
  scenes: InteractiveWritingSceneOption[],
  binding: NarrativeNode['bindings'][number] | undefined,
) => bindingScriptSceneRefs(binding).flatMap((ref) => {
  const scene = scenes.find((candidate) => (
    candidate.ref.artifactId === ref.artifactId
    && candidate.ref.versionId === ref.versionId
    && candidate.ref.checksum === ref.checksum
  ));
  return scene ? [scene] : [];
});

export default function InteractiveProductionWorkspace() {
  const { experienceId = '' } = useParams<{ experienceId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedNodeId = searchParams.get('nodeId');
  const returnToWhiteboard = searchParams.get('returnTo') === 'graph';
  const [aggregate, setAggregate] = useState<InteractiveExperienceAggregate | null>(null);
  const [runtimeBuild, setRuntimeBuild] = useState<InteractiveRuntimeBuild | null>(null);
  const [writingScenes, setWritingScenes] = useState<InteractiveWritingSceneOption[]>([]);
  const [activeNodeId, setActiveNodeId] = useState('');
  const [productionTarget, setProductionTarget] = useState<InteractiveProductionPrepTarget | null>(null);
  const [isOpeningPreparation, setIsOpeningPreparation] = useState(false);
  const [mediaTakes, setMediaTakes] = useState<InteractiveProductionMediaTakeOption[]>([]);
  const [isBindingMedia, setIsBindingMedia] = useState(false);
  const [isLoadingNodeDetails, setIsLoadingNodeDetails] = useState(false);
  const [showBoundScript, setShowBoundScript] = useState(false);

  useEffect(() => {
    Promise.all([
      interactiveClient.getExperience(experienceId),
      interactiveClient.getLatestRuntimeBuild(experienceId),
    ])
      .then(([nextAggregate, nextRuntimeBuild]) => {
        setAggregate(nextAggregate);
        setRuntimeBuild(nextRuntimeBuild);
        setActiveNodeId((current) => {
          const productionNodes = nextAggregate.graph.nodes.filter(nodeRequiresMainContent);
          if (requestedNodeId && productionNodes.some((node) => node.id === requestedNodeId)) {
            return requestedNodeId;
          }
          return productionNodes.some((node) => node.id === current)
            ? current
            : productionNodes[0]?.id || '';
        });
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '制片汇总读取失败'));
    interactiveClient.getProductionPrepTarget(experienceId)
      .then(setProductionTarget)
      .catch((error) => toast.error(error instanceof Error ? error.message : '制片工作台项目读取失败'));
  }, [experienceId, requestedNodeId]);

  useEffect(() => {
    if (
      !activeNodeId
      || !aggregate
      || aggregate.experience.id !== experienceId
      || !aggregate.graph.nodes.some((node) => node.id === activeNodeId)
    ) {
      setWritingScenes([]);
      setMediaTakes([]);
      setIsLoadingNodeDetails(false);
      return;
    }
    let active = true;
    setWritingScenes([]);
    setMediaTakes([]);
    setIsLoadingNodeDetails(true);
    Promise.allSettled([
      interactiveClient.listWritingScenes(experienceId, activeNodeId),
      interactiveClient.listProductionMediaTakes(experienceId, activeNodeId),
    ])
      .then(([sceneResult, mediaResult]) => {
        if (!active) return;
        if (sceneResult.status === 'fulfilled') {
          setWritingScenes(sceneResult.value);
        } else {
          toast.error(sceneResult.reason instanceof Error ? sceneResult.reason.message : '当前节点剧本读取失败');
        }
        if (mediaResult.status === 'fulfilled') {
          setMediaTakes(mediaResult.value);
        } else {
          toast.error(mediaResult.reason instanceof Error ? mediaResult.reason.message : '当前节点画面读取失败');
        }
      })
      .finally(() => {
        if (active) setIsLoadingNodeDetails(false);
      });
    return () => {
      active = false;
    };
  }, [activeNodeId, aggregate, experienceId]);

  const productionNodes = useMemo(
    () => aggregate?.graph.nodes.filter(nodeRequiresMainContent) || [],
    [aggregate],
  );
  const productionNodeGroups = useMemo(() => {
    if (!aggregate) return [];
    const nodeById = new Map(productionNodes.map((node) => [node.id, node]));
    const groups = buildInteractiveStoryUnits(aggregate.storyArchitecture.data, aggregate.graph)
      .map((unit) => ({
        ...unit,
        nodes: unit.nodeIds.flatMap((nodeId) => {
          const node = nodeById.get(nodeId);
          return node ? [node] : [];
        }),
        productionSceneCount: new Set(
          (productionTarget?.nodeTargets || [])
            .filter((target) => unit.nodeIds.includes(target.nodeId))
            .flatMap((target) => target.productionSceneIds),
        ).size,
      }))
      .filter((unit) => unit.nodes.length > 0);
    return groups.length ? groups : [{
      id: 'all',
      title: '完整故事',
      summary: '',
      order: 1,
      nodeIds: productionNodes.map((node) => node.id),
      nodes: productionNodes,
      productionSceneCount: new Set(
        (productionTarget?.nodeTargets || []).flatMap((target) => target.productionSceneIds),
      ).size,
      targetDurationRangeSec: [0, 0] as [number, number],
    }];
  }, [aggregate, productionNodes, productionTarget]);
  const activeNode = useMemo(
    () => productionNodes.find((node) => node.id === activeNodeId) || productionNodes[0],
    [activeNodeId, productionNodes],
  );
  useEffect(() => setShowBoundScript(false), [activeNodeId]);
  const activeStoryGroup = productionNodeGroups.find((group) =>
    group.nodes.some((node) => node.id === activeNode?.id),
  );
  const activeBinding = aggregate?.bindings.find((binding) => binding.nodeId === activeNode?.id && binding.slot === 'main');
  const activeScenes = scenesForBinding(writingScenes, activeBinding);
  const activeScene = activeScenes[0];
  const activeMediaRefs = bindingMediaTakeRefs(activeBinding);
  const activeContentReviewRecommended = Boolean(activeBinding && bindingNeedsContentReview(activeBinding));
  const activeMediaReviewRecommended = Boolean(activeBinding && bindingNeedsMediaReview(activeBinding));
  const activeFeedback = productionTarget?.nodeFeedback
    ?.filter((item) => item.nodeId === activeNode?.id)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  const reviewedMediaChecksums = new Set(activeBinding?.mediaFitReview?.mediaChecksums || []);
  const availableMediaChecksums = new Set(mediaTakes.map((take) => take.ref.checksum));
  const mediaBindingCurrent = activeMediaRefs.length > 0
    && activeMediaRefs.every((ref) => availableMediaChecksums.has(ref.checksum))
    && activeMediaRefs.every((ref) => reviewedMediaChecksums.has(ref.checksum))
    && !activeMediaReviewRecommended;

  if (!aggregate) {
    return <div className="flex h-full items-center justify-center bg-bg-primary"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }

  const activeContentReady = Boolean(activeBinding && hasCurrentContentFitReview(activeBinding));
  const runtimeReady = runtimeBuild?.status === 'ready_for_player';
  const writingProjectId = aggregate.experience.storySource.writingProjectId;
  const writingRevision = activeScene?.writingProjectRevision;
  const whiteboardPath = `/interactive/experiences/${experienceId}/graph${activeNode ? `?nodeId=${encodeURIComponent(activeNode.id)}` : requestedNodeId ? `?nodeId=${encodeURIComponent(requestedNodeId)}` : ''}`;
  const productionReturnTo = `/interactive/experiences/${experienceId}/production${activeNode ? `?nodeId=${encodeURIComponent(activeNode.id)}${returnToWhiteboard ? '&returnTo=graph' : ''}` : returnToWhiteboard ? '?returnTo=graph' : ''}`;
  const writingTarget = writingProjectId
    ? `/writing?${new URLSearchParams({ projectId: writingProjectId, returnTo: productionReturnTo, ...(activeScene ? { unitId: activeScene.unitId, sceneId: activeScene.sceneId, view: 'studio' } : {}) })}`
    : '';
  const openSharedPreparation = async () => {
    if (!activeContentReady) {
      toast.error('当前节点的剧本来源有更新，请先在白板复核这个节点');
      return;
    }
    setIsOpeningPreparation(true);
    try {
      const reusableTarget = productionTarget?.nodeTargets?.some((candidate) => (
        candidate.nodeId === activeNode?.id && candidate.isCurrentForNode
      ));
      const target = reusableTarget
        ? productionTarget
        : await interactiveClient.ensureProductionPrepTarget(experienceId);
      setProductionTarget(target);
      const returnTo = productionReturnTo;
      const nodeTarget = target.nodeTargets?.find((candidate) => candidate.nodeId === activeNode?.id);
      const params = new URLSearchParams({
        projectId: target.productionProjectId,
        returnTo,
      });
      if (nodeTarget) {
        params.set('episodeId', nodeTarget.productionEpisodeId);
        if (nodeTarget.productionSceneIds.length === 1) {
          params.set('sceneId', nodeTarget.productionSceneIds[0]);
        } else {
          // No adopted scene yet, or this node legitimately spans several
          // scenes. Open the source-unit overview rather than guessing.
          params.set('tab', 'overview');
        }
      }
      navigate(`/production/preparation?${params}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '建立制片工作台项目失败');
    } finally {
      setIsOpeningPreparation(false);
    }
  };
  const bindCurrentNodeMedia = async () => {
    if (!activeNode || bindingScriptSceneRefs(activeBinding).length === 0 || mediaTakes.length === 0) return;
    setIsBindingMedia(true);
    try {
      const plan = await interactiveClient.createMediaPlan(experienceId);
      const selections = plan.selections.filter((selection) => selection.nodeId === activeNode.id);
      const missingNode = plan.missingNodeIds.includes(activeNode.id);
      const missingScenario = plan.missingScenarios?.some((item) => item.nodeId === activeNode.id);
      const missingSlot = plan.missingContentSlots?.some((item) => item.nodeId === activeNode.id);
      if (missingNode || missingScenario || missingSlot || selections.length === 0) {
        throw new Error('当前节点仍有画面状态或播放位置未完成，请先补齐后再确认');
      }
      const refs = selections.flatMap((selection) => selection.takeRefs)
        .filter((ref, index, candidates) => candidates.findIndex((candidate) => (
          candidate.artifactId === ref.artifactId
          && candidate.versionId === ref.versionId
          && candidate.checksum === ref.checksum
        )) === index);
      const mediaScenarios = selections.every((selection) => selection.scenarioId && selection.reuseFingerprint)
        ? selections.map((selection) => ({
            scenarioId: selection.scenarioId!,
            stateFingerprint: selection.stateFingerprint,
            reuseFingerprint: selection.reuseFingerprint!,
            mediaTakeRefs: selection.takeRefs,
          }))
        : [];
      const nextAggregate = await interactiveClient.saveBinding(experienceId, {
        ...activeBinding,
        nodeId: activeNode.id,
        slot: 'main',
        mediaTakeRefs: refs,
        mediaScenarios,
        visibleStateSignature: mediaScenarios.length
          ? mediaScenarios.map((scenario) => scenario.reuseFingerprint).sort().join('|')
          : activeBinding?.visibleStateSignature,
        reusePolicy: mediaScenarios.length ? 'compatible_states_only' : activeBinding?.reusePolicy,
        mediaFitReview: {
          verdict: 'pass',
          rationale: `作者在互动制片中采用了当前方案选定的 ${refs.length} 段画面，用于节点“${activeNode.brief.title}”的路径播放。`,
          reviewedAt: new Date().toISOString(),
          mediaChecksums: refs.map((ref) => ref.checksum),
        },
      });
      setAggregate(nextAggregate);
      toast.success(`已采用 ${refs.length} 段画面`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '画面确认失败');
    } finally {
      setIsBindingMedia(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg-primary text-text-primary transition-colors duration-200">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border-soft/30 bg-bg-surface px-6 py-4 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigate(returnToWhiteboard ? whiteboardPath : `/interactive/experiences/${experienceId}/graph`)} className="rounded-xl p-2 text-text-muted hover:bg-bg-surface-soft hover:text-text-primary transition-colors" aria-label={returnToWhiteboard ? '返回互动白板中的当前节点' : '打开互动白板'}><ArrowLeft className="h-4 w-4" /></button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-base font-extrabold text-text-primary"><Clapperboard className="h-5 w-5 text-gold" /> 互动制片工作台</h1>
            <p className="mt-0.5 truncate text-xs text-text-muted">{returnToWhiteboard ? '从白板进入，完成画面后回到故事继续试玩。' : `${aggregate.experience.title} · 查看并完善故事画面`}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!runtimeReady && <span className="hidden text-xs font-medium text-text-muted md:inline">画面未完成时也可以先验证故事选择</span>}
          <Link to={`/interactive/experiences/${experienceId}/playtest`} className="flex shrink-0 items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-bold text-gold hover:bg-gold/20 transition-colors"><Play className="h-4 w-4 fill-current" /> {runtimeReady ? '用成片试玩' : '用剧本试玩'}</Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
          <aside className="w-80 shrink-0 overflow-y-auto border-r border-border-soft/30 bg-bg-surface p-4">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-xs font-bold text-text-muted uppercase tracking-wider">故事节点</h2><span className="rounded-lg bg-bg-surface-soft px-2 py-0.5 text-[10px] font-bold text-text-secondary border border-border-soft/30">{productionNodes.length} 个</span></div>
            <div className="space-y-6">
              {productionNodeGroups.map((group) => (
                <section key={group.id}>
                  <div className="mb-2.5 border-b border-border-soft/20 pb-2">
                    <div className="truncate text-xs font-bold text-gold">
                      {group.episodeTitle ? `${group.episodeTitle} · ` : ''}第{group.order}章 · {group.title.replace(/^第[一二三四五六七八九十百\d]+章[：:]\s*/, '')}
                    </div>
                    <div className="mt-0.5 text-[10px] text-text-muted">
                      {group.nodes.length} 个故事节点 · {group.productionSceneCount} 个制片场次
                    </div>
                  </div>
                  <div className="space-y-2">
                  {group.nodes.map((node) => {
                    const binding = aggregate.bindings.find((candidate) => candidate.nodeId === node.id && candidate.slot === 'main');
                    const reviewRecommended = Boolean(binding && bindingNeedsContentReview(binding));
                    const ready = Boolean(binding && hasCurrentContentFitReview(binding));
                    const active = activeNode?.id === node.id;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => setActiveNodeId(node.id)}
                        className={`w-full border p-3.5 text-left rounded-xl transition-all ${active ? 'border-gold bg-gold/10 shadow-md' : 'border-border-soft/30 bg-bg-surface-soft/60 hover:border-border-soft/60'}`}
                      >
                        <div className="flex items-start justify-between gap-2"><span className="text-xs font-bold text-text-primary">{node.brief.title}</span><span className={ready ? 'text-[10px] font-bold text-emerald-500' : 'text-[10px] font-bold text-amber-500'}>{ready ? '剧本已就绪' : reviewRecommended ? '建议复核' : 'AI 待准备'}</span></div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">{node.brief.intent || node.brief.narrativeSummary}</p>
                      </button>
                    );
                  })}
                  </div>
                </section>
              ))}
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto p-6 md:p-8">
            {activeNode ? (
              <div className="mx-auto max-w-4xl space-y-6">
                <section className="border-b border-border-soft/30 pb-6">
                  <span className="text-xs font-bold text-gold uppercase tracking-wider">正在制作</span>
                  <h2 className="mt-2 text-2xl font-extrabold text-text-primary">{activeNode.brief.title}</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-text-muted">{activeNode.brief.narrativeSummary || activeNode.brief.intent || '请先在故事地图补充这个节点的叙事目标。'}</p>
                  {(activeContentReviewRecommended || activeMediaReviewRecommended) && (
                    <p className="mt-3 flex items-center gap-2 text-xs font-bold text-amber-500">
                      <AlertTriangle className="h-4 w-4" />
                      来源有更新，已采用结果仍保留，建议复核当前节点。
                    </p>
                  )}
                </section>

                <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
                  <article className="border border-border-soft/30 bg-bg-surface p-6 rounded-2xl shadow-md">
                    <div className="flex items-center gap-2 text-xs font-bold text-text-primary"><FileText className="h-4 w-4 text-gold" /> 这个节点播放的故事</div>
                    {isLoadingNodeDetails ? (
                      <p className="mt-4 flex items-center gap-2 text-xs text-text-muted"><Loader2 className="h-4 w-4 animate-spin text-gold" />正在读取当前节点</p>
                    ) : activeScenes.length > 0 ? (
                      <>
                        <div className="mt-4 space-y-3">
                          {activeScenes.map((scene, index) => (
                            <div key={scene.ref.checksum} className="border-l-2 border-gold pl-3 py-0.5">
                              <h3 className="text-xs font-bold text-text-primary">{index + 1}. 第 {scene.unitIndex} 单元 · 场 {scene.sceneIndex}：{scene.sceneTitle}</h3>
                              <p className="mt-1 text-xs leading-6 text-text-muted">{scene.synopsis}</p>
                            </div>
                          ))}
                        </div>
                        <p className="mt-4 text-[11px] text-text-muted">按以上顺序播放 · 共 {activeScenes.length} 场</p>
                        <button type="button" onClick={() => setShowBoundScript((value) => !value)} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-bold text-gold hover:bg-gold/20 transition-colors"><FileText className="h-4 w-4" /> {showBoundScript ? '收起绑定剧本' : '查看绑定剧本交付快照'}</button>
                        {showBoundScript && <div className="mt-4 space-y-4 rounded-xl border border-border-soft/30 bg-bg-surface-soft p-4">
                          <p className="text-xs text-text-muted">固定交付内容 · 剧本修订 {writingRevision} · 按节点选定场次顺序</p>
                          {activeScenes.map((scene, index) => <section key={scene.ref.checksum} className="space-y-2">
                            <h4 className="text-xs font-bold text-text-primary">{index + 1}. {scene.sceneTitle}</h4>
                            {(scene.scriptBlocks || []).map((block, blockIndex) => <p key={blockIndex} className="whitespace-pre-wrap text-xs leading-6 text-text-secondary">{block.content}</p>)}
                          </section>)}
                        </div>}
                        {writingTarget && <Link to={writingTarget} className="mt-3 ml-2 inline-flex items-center gap-2 text-xs text-text-muted underline hover:text-gold">编辑剧本当前稿</Link>}
                      </>
                    ) : (
                      <p className="mt-4 text-xs leading-6 text-amber-500 font-medium">这个节点的故事还没准备好。请回到白板让 AI 继续安排。</p>
                    )}
                  </article>

                  <article className="border border-border-soft/30 bg-bg-surface p-6 rounded-2xl shadow-md">
                    <div className="flex items-center gap-2 text-xs font-bold text-text-primary"><Sparkles className="h-4 w-4 text-gold" /> 制作画面</div>
                    <p className="mt-3 text-xs leading-6 text-text-muted">可以手动准备人物、场景、镜头和故事板，也可以让 AI 辅助，再查看并修改方案。</p>
                    {activeFeedback && (
                      <div className="mt-3 border-l-2 border-sky-400 pl-3">
                        <p className="text-[10px] font-bold text-sky-400">你从白板提出的调整</p>
                        <p className="mt-1 text-xs leading-5 text-text-muted">{activeFeedback.feedback}</p>
                      </div>
                    )}
                    {productionTarget ? (
                      <p className="mt-3 text-[11px] font-bold text-emerald-500">画面制作已经开始，可以继续查看当前节点。</p>
                    ) : (
                      <p className="mt-3 text-[11px] font-bold text-gold">还没有画面方案。</p>
                    )}
                    <button
                      type="button"
                      disabled={isOpeningPreparation || !activeContentReady}
                      onClick={() => void openSharedPreparation()}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-xs font-bold text-bg-primary hover:bg-gold-light transition-all shadow-md shadow-gold/20 disabled:opacity-50"
                    >
                      {isOpeningPreparation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
                      {!activeContentReady ? '先复核当前节点' : productionTarget ? '继续制作画面' : '开始制作画面'}
                    </button>
                  </article>
                </section>

                <section className="border border-border-soft/30 bg-bg-surface p-6 rounded-2xl shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-bold text-text-primary"><Video className="h-4 w-4 text-gold" /> 已确认的画面</div>
                      {isLoadingNodeDetails ? (
                        <p className="mt-3 flex items-center gap-2 text-xs text-text-muted"><Loader2 className="h-4 w-4 animate-spin text-gold" />正在读取已确认画面</p>
                      ) : mediaTakes.length === 0 ? (
                        <p className="mt-3 max-w-2xl text-xs leading-6 text-text-muted">当前节点还没有已确认的画面。你仍可直接用正式剧本试玩完整节点、选择、结局和路径时长；故事板可以先作为占位画面，完成视频后会自动切换。</p>
                      ) : (
                        <>
                          <p className="mt-3 max-w-2xl text-xs leading-6 text-text-muted">找到 {mediaTakes.length} 个可用版本。确认时每个镜头只会采用当前已选版本，并按进入、主体、离开和选择等待的顺序播放。</p>
                          <ul className="mt-3 space-y-1 text-xs text-text-muted">
                            {mediaTakes.map((take) => (
                              <li key={take.ref.checksum} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                                <span>{take.label}</span>
                                <span>· {take.mediaKind === 'image' ? '故事板占位' : '视频'}</span>
                                {take.mediaKind === 'video' && <span>· {take.embeddedAudio ? '含原声' : '无原声'}</span>}
                                <span>· {take.durationSeconds || '未标注'} 秒</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                    {mediaTakes.length > 0 && (
                      <button
                        type="button"
                        disabled={isBindingMedia || bindingScriptSceneRefs(activeBinding).length === 0 || mediaBindingCurrent}
                        onClick={() => void bindCurrentNodeMedia()}
                        className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-xs font-bold text-bg-primary hover:bg-gold-light transition-all shadow-md shadow-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
                        title={bindingScriptSceneRefs(activeBinding).length === 0 ? '请先让 AI 准备当前节点的故事' : mediaBindingCurrent ? '当前节点已确认这批画面' : '确认这些画面用于当前节点'}
                      >
                        {isBindingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                        {mediaBindingCurrent ? '当前画面已确认' : '确认当前画面组合'}
                      </button>
                    )}
                  </div>
                </section>

              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-text-muted">当前范围只有路由或状态节点，不需要进入制片工作台。可返回试玩验证互动逻辑。</div>
            )}
          </main>
        </div>
    </div>
  );
}
