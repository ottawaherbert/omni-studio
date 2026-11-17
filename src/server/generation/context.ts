import { withCharacterReferenceUsage, characterReferenceOwner, characterReferenceUsage, characterReferenceBasis, characterReferenceSourceHash } from '../../services/production/characterReferenceLayouts';
import { appearanceBoards } from '../../services/production/productionAppearance';
import { locationViewBoards } from '../../services/production/locationViewReferences';
import { renderLocationSpatialAnchor, locationViewDependencies, locationViewImage, locationViewInputIssue, locationViewUsage, locationViewLabels, locationViewCurrentIssue } from '../../services/production/locationViews';
import { observedReferenceIssue } from "../../services/production/productionCollaboration";
import { generationProductionBasis } from "../../services/production/productionSceneBasis";
import { GenerationError, GLOBAL_GENERATION_SCOPE, type GenerationReference, type GenerationTarget } from '../../../packages/domain/src/generation';
import { dbHelpers } from '../db';
import type { Episode, Project, Scene } from '../../types/project';
import { buildManualProductionAssetReadModel } from '../../services/production/manualProductionAssets';
import { buildVideoStoryboardAssetBoardPlan } from '../../services/production/videoStoryboardAssetBoards';
import { buildProductionAssetBoardPromptPreview } from '../../services/production/productionAssetBoardExecution';
import { buildStoryboardCompositeBoardPrompt, buildStoryboardCompositeBoardSourceHash, scopeStoryboardCompositeBoardToPage, selectStoryboardCompositeBoardReferences } from '../../services/production/storyboardCompositeBoard';
import { renderSceneContinuityBasis, sceneVisualPlanForShots, sceneStoryboardContentHash, sceneContinuityBasis, sceneReferencesForShots } from '../../services/production/sceneVisualPlan';
import { buildVideoContinuityContext } from '../../../packages/production/src/services/production/videoContinuityContext';
import { resolveProductionCreativeVisual } from '../../../packages/production/src/services/production/creativeDirection';
import { visualStyleContentHash } from '../../../packages/production/src/services/production/visualStyleMigration';
import { generationHash } from './catalog';
import { reviewProductionTiming } from '../../services/production/productionTiming';
import { readPrevisDocument, previsSceneKey } from '../previsStore';
import { previsExportCurrent, previsReferenceNote, type PrevisWorld, type ScenePrevis } from '../../../packages/domain/src/previs';
import { listPrevisVideos, previsVideoCurrent } from '../previsVideo';
import { createPrevisContactProblemReader } from '../spatial/contactChecks';

export function loadGenerationContext(raw: GenerationTarget) {
  if (!raw || typeof raw.projectId !== 'string' || !['asset', 'board', 'video_unit', 'shot', 'scene', 'scratch'].includes(raw.kind) || !Array.isArray(raw.shotIds)) throw new GenerationError('TARGET_REQUIRED', '请选择有效的项目和生成目标。');
  if (raw.kind === 'scratch') {
    if (raw.shotIds.length || raw.sceneId || raw.episodeId || raw.assetId) throw new GenerationError('TARGET_INVALID', '临时任务不能伪装为正式制作对象。');
    const owner = raw.projectId === GLOBAL_GENERATION_SCOPE ? undefined : dbHelpers.getProjectShellById(raw.projectId) as Project | undefined;
    if (raw.projectId !== GLOBAL_GENERATION_SCOPE && !owner) throw new GenerationError('TARGET_NOT_FOUND', '任务所属项目已不存在。', 404);
    return { project: owner || { id: GLOBAL_GENERATION_SCOPE, title: '独立生成', aspectRatio: '16:9' } as Project, target: structuredClone(raw), episode: undefined, scene: undefined, shots: [] as Scene['shots'], workflow: undefined, page: undefined, asset: undefined, references: [] as GenerationReference[], sourceHash: generationHash(raw), legacySourceHash: undefined, sourceRevision: 0, boardSourceHash: undefined, productionBasis: undefined, preCollaborationSourceHash: undefined, prompt: '', videoPrompt: '', narrativeSeconds: 0, timingReview: undefined, label: owner ? `${owner.title} · 自定义生成` : '独立生成' };
  }
  const project = dbHelpers.getProjectShellById(raw.projectId) as Project | undefined;
  if (!project) throw new GenerationError('TARGET_NOT_FOUND', '当前项目已不存在。', 404);
  const episode = raw.episodeId ? dbHelpers.getEpisodeById(project.id, raw.episodeId) as Episode | undefined : undefined;
  if (raw.episodeId && !episode) throw new GenerationError('TARGET_NOT_FOUND', '当前分集已不存在。', 404);
  project.episodes = episode ? [episode] : [];
  const scene = episode?.scenes.find(s => s.id === raw.sceneId);
  if (raw.kind !== 'asset' && !scene) throw new GenerationError('TARGET_NOT_FOUND', '当前场次已不存在，请返回场次列表。', 404);
  const target = structuredClone(raw);
  const assets = scene && episode ? buildManualProductionAssetReadModel({ project, episode, scene }) : undefined;
  const assetPlan = buildVideoStoryboardAssetBoardPlan(project);
  const assetItems = [...assetPlan.characterBoards, ...assetPlan.sceneBoards, ...assetPlan.sceneViewBoards, ...assetPlan.characterReferenceBoards, ...assetPlan.propBoards, ...assetPlan.vehicleBoards, ...assetPlan.variantBoards];
  const asset = target.kind === 'asset' ? assetItems.find(a => a.id === target.assetId) : undefined;
  if (target.kind === 'asset' && !asset) throw new GenerationError('TARGET_NOT_FOUND', '找不到当前资产板，请重新选择。', 404);
  const workflow = scene?.manualStoryboard?.boards?.find(w => (target.boardId && (w.boardId === target.boardId || w.board?.id === target.boardId)) || (target.unitId && (w.videoGenerationUnitId === target.unitId || w.id === target.unitId)));
  const page = workflow?.board?.visualPages?.find(p => p.id === target.pageId) || (target.kind === 'board' ? workflow?.board?.visualPages?.[0] : undefined);
  if (target.kind === 'board' && (!workflow?.board || !page)) throw new GenerationError('TARGET_NOT_FOUND', '请先在宫格预览中建立本片段画格结构，再准备生成。', 404);
  if (target.kind === 'video_unit' && !workflow?.board) throw new GenerationError('TARGET_NOT_FOUND', '视频单元已变化，请重新选择片段。', 404);
  const pageShotIds = workflow?.board && page ? [...new Set(workflow.board.panels.filter(p => page.panelIds.includes(p.id)).map(p => p.shotId))] : undefined;
  if (workflow?.board && !target.shotIds.length) target.shotIds = pageShotIds || workflow.board.shotIds;
  const expectedShots = target.kind === 'board' ? pageShotIds : target.kind === 'video_unit' ? workflow?.board?.shotIds : undefined;
  if (expectedShots && (expectedShots.length !== target.shotIds.length || expectedShots.some((id, i) => id !== target.shotIds[i]))) throw new GenerationError('TARGET_RANGE_CHANGED', '镜头范围与当前宫格或片段不一致，请重新选择。', 409);
  if (target.kind === 'scene' && !target.shotIds.length) target.shotIds = (scene?.shots || []).map(s => s.id);
  const shots = scene?.shots?.filter(s => target.shotIds.includes(s.id)) || [];
  if (target.kind !== 'asset' && (!shots.length || new Set(target.shotIds).size !== target.shotIds.length || shots.length !== target.shotIds.length)) throw new GenerationError('TARGET_RANGE_CHANGED', '镜头范围已变化，请重新选择片段，不会自动切换目标。', 409);
  const references: GenerationReference[] = [];
  // Advanced references stay opt-in. Merely editing a world does not change an ordinary task's source hash.
  const previsWorld = scene && readPrevisDocument<PrevisWorld>(project.id, 'world');
  const previs = scene && episode && readPrevisDocument<ScenePrevis>(project.id, previsSceneKey(episode.id, scene.id));
  const contactProblem = scene && createPrevisContactProblemReader(project.id, scene.id);
  if (previsWorld && previs) for (const item of previs.exports) references.push({ id: `previs:${item.id}`, label: `白模宫格 · ${item.frameIds.length} 格 · ${item.narrativeSeconds} 秒`, mediaKind: 'image', mediaUrl: item.imageUrl, mediaVersionId: item.id, contentHash: item.contentHash, role: 'composition', sourceShotIds: item.shotIds, shotIds: item.shotIds, enabled: false, locked: false, source: 'preset', status: previsExportCurrent(previs.plan, item, scene!, project.aspectRatio, previsWorld.plan) ? 'candidate' : 'source_changed', usageNote: previsReferenceNote(previs.plan, item), qualityIssue: contactProblem!(item.shotIds), previsSource: { exportId: item.id, sceneId: scene!.id, sourceHash: item.sourceHash, kind: 'grid' } });
  if (scene) for (const video of listPrevisVideos(project.id).filter(v => v.status === 'complete' && v.scope === 'scene' && v.sceneId === scene.id && v.episodeId === episode?.id)) references.push({ id: `previs:${video.id}`, label: `白模动态预演 · ${video.timeline.duration} 秒`, mediaKind: 'video', mediaUrl: video.videoUrl!, mediaVersionId: video.id, role: 'motion', sourceShotIds: video.timeline.shots.map(s => s.shotId), enabled: false, locked: false, source: 'preset', status: previsVideoCurrent(video) ? 'candidate' : 'source_changed', usageNote: '此视频为三维白模摄影预演，只参考机位、动作、空间和切镜节奏。人物身份、服装和环境外观使用独立资产图；不保留人偶和灰模外观。预演没有对白和声音，不是最终成片。', qualityIssue: contactProblem!(video.timeline.shots.map(s => s.shotId)), previsSource: { exportId: video.id, sceneId: scene.id, sourceHash: video.timeline.sourceHash, kind: 'video' } });
  const rawAssetBoards = assets ? (shots.some(s => s.locationReferenceViews?.length) ? locationViewBoards(project, shots, assets.assetBoards) : assets.assetBoards) : [];
  const scopedAssetBoards = shots.some(s=>s.appearance?.states.some(state=>state.decision==='accepted'))
    ? shots.flatMap(shot=>appearanceBoards(project,[shot],rawAssetBoards,'image').filter(board=>[...(shot.characterIdsInShot||[]),...(shot.dialogueLines||[]).map(l=>l.characterId),shot.locationId,...(shot.propIds||[]),...(shot.vehicleIds||[])].includes(board.assetId))) : rawAssetBoards;
  const selectedAssetBoards = withCharacterReferenceUsage(project,scopedAssetBoards).filter((b,i,list)=>list.findIndex(x=>x.boardItemId===b.boardItemId)===i);
  for (const board of selectedAssetBoards) if (board.referenceImageUrl) references.push({ characterReferenceLayout: board.characterReferenceLayout, locationView: board.locationView, usageNote: board.assetType === 'location' ? (board.locationView ? board.prompt : renderLocationSpatialAnchor(project.assets.find(a => a.id === board.assetId)!, 'main', board.variantId)) || undefined : board.assetType === 'character' ? characterReferenceUsage(board.characterReferenceLayout, board.variantName) : undefined, qualityIssue: board.locationViewIssue, id: `asset:${board.boardItemId}`, label: board.assetName + (board.variantName ? ` · ${board.variantName}` : ''), mediaKind: 'image', mediaUrl: board.referenceImageUrl, mediaVersionId: `asset:${board.boardItemId}:${generationHash(board.referenceImageUrl).slice(0, 16)}`, sourceAssetId: board.boardItemId, role: board.assetType === 'character' ? 'character_identity' : board.assetType === 'location' ? 'environment' : 'prop_identity', enabled: false, locked: false, source: 'preset', status: board.approvalState === 'stale' ? 'source_changed' : 'adopted' });
  if (!assets && !asset?.locationView && !asset?.characterReferenceLayout) for (const item of [...(project.characters || []), ...(project.assets || [])]) {
    const image = (item as any).referenceImageUrl || (item as any).imageUrl;
    if (typeof image === 'string' && image) references.push({ id: `asset:${item.id}`, label: item.name, mediaKind: 'image', mediaUrl: image, mediaVersionId: `asset:${item.id}:${generationHash(image).slice(0, 16)}`, sourceAssetId: item.id, role: 'character_identity', enabled: false, locked: false, source: 'preset', status: 'adopted' });
  }
  const locationViewIssues: string[] = [];
  for (const shot of shots.filter(s => s.locationReferenceViews?.length)) if (!project.assets.some(a => a.id === shot.locationId && a.type === 'location')) locationViewIssues.push('已选择场景视角的镜头缺少有效场景资产。');
  const requiredLocationReferenceIds: string[] = [];
  if (asset?.characterReferenceLayout) {
    const character = project.characters.find(c => c.id === asset.assetId)!;
    const url = characterReferenceBasis(character, asset.variantId);
    if (url) {
      const id = `character-layout-input:${character.id}:${asset.variantId || 'base'}`;
      requiredLocationReferenceIds.push(id);
      references.push({id,label:`${character.name} · 原角色/状态参考`,mediaKind:'image',mediaUrl:url,mediaVersionId:`${id}:${generationHash(url).slice(0,16)}`,role:'character_identity',sourceAssetId:id,enabled:true,locked:false,source:'preset',status:'adopted',usageNote:'以本图锁定同一角色、服装和当前状态；仅按本任务改变参考图版式。'});
    }
  }
  for (const board of selectedAssetBoards.filter(b => b.assetType === 'character' && !b.referenceImageUrl)) locationViewIssues.push(`${board.assetName}：本镜对应的角色状态参考尚未形成，请先制作并采用该状态资产。`);
  if (asset?.locationView) {
    const owner = project.assets.find(a => a.id === asset.assetId)!;
    const issue = locationViewInputIssue(project, owner, asset.locationView, asset.variantId);
    if (issue) locationViewIssues.push(issue);
    for (const view of locationViewDependencies(asset.locationView)) {
      const url = locationViewImage(owner, view, asset.variantId);
      if (!url) continue;
      const id = `location-input:${owner.id}:${asset.variantId || 'base'}:${view}`;
      requiredLocationReferenceIds.push(id);
      references.push({ id, locationView: view, label: `${owner.name} · ${locationViewLabels[view]}`, mediaKind: 'image', mediaUrl: url, mediaVersionId: `${id}:${generationHash(url).slice(0,16)}`, sourceAssetId: id, role: 'environment', usageNote: [locationViewUsage(view), renderLocationSpatialAnchor(owner, view, asset.variantId)].filter(Boolean).join('\n'), enabled: true, locked: false, source: 'preset', status: view !== 'main' && locationViewCurrentIssue(project, owner, view, asset.variantId) ? 'source_changed' : 'adopted' });
    }
  }
  for (const board of selectedAssetBoards.filter(b => b.locationView)) {
    if (!board.referenceImageUrl || board.locationViewIssue) locationViewIssues.push(`${board.assetName}：${board.locationViewIssue || '尚未采用参考图。'}`);
    requiredLocationReferenceIds.push(`asset:${board.boardItemId}`);
  }
  for (const [unitIndex, unit] of (scene?.manualStoryboard?.boards || []).entries()) for (const visualPage of unit.board?.visualPages || []) {
    const pageShots = unit.board?.panels.filter(p => visualPage.panelIds.includes(p.id)).map(p => p.shotId) || [];
    if (!pageShots.every(id => target.shotIds.includes(id))) continue;
    const boardShots = scene!.shots.filter(shot => pageShots.includes(shot.id));
    const boardReferences = assets && selectStoryboardCompositeBoardReferences({ project, board: scopeStoryboardCompositeBoardToPage(unit.board!, visualPage), shots: boardShots, assets }).selected;
    const currentBoardHash = boardReferences && buildStoryboardCompositeBoardSourceHash({ project, board: unit.board!, page: visualPage, shots: boardShots, references: boardReferences });
    for (const [takeIndex, take] of (visualPage.visualTakes || []).entries()) references.push({ id: `board:${take.id}`, label: `片段 ${unitIndex + 1} 宫格 · 版本 ${takeIndex + 1}${take.status === 'rejected' ? ' · 已拒绝' : ''}`, mediaKind: 'image', mediaUrl: take.videoReferenceImageUrl || take.sourceImageUrl || take.imageUrl, mediaVersionId: take.id, sourceTakeId: take.id, shotIds: pageShots, role: 'board_sequence', enabled: false, locked: false, source: 'preset', status: take.status === 'stale' || take.sourceHash !== currentBoardHash ? 'source_changed' : take.status === 'adopted' && take.review?.status === 'approved' && visualPage.activeVisualTakeId === take.id ? 'adopted' : 'candidate' });
  }
  for (const ref of sceneReferencesForShots(scene?.visualPlan, target.shotIds)) references.push({ id: `scene-reference:${ref.id}`, label: ref.note || (ref.role === 'space' ? '本场空间基准' : '衔接状态参考'), mediaKind: 'image', mediaUrl: ref.imageUrl, mediaVersionId: `scene-reference:${ref.id}:${generationHash(ref.imageUrl).slice(0, 16)}`, role: ref.role === 'space' ? 'environment' : 'composition', enabled: false, locked: false, source: 'preset', status: 'adopted' });
  if (scene?.visualPlan?.overview) {
    const overview = scene.visualPlan.overview;
    references.push({ id: `overview:${scene.id}`, label: '整场故事板总览', mediaKind: 'image', mediaUrl: overview.imageUrl, mediaVersionId: overview.candidateId || generationHash(overview), sourceTakeId: overview.candidateId, shotIds: overview.shotIds, sourceShotIds: overview.shotIds, role: 'board_sequence', enabled: false, locked: false, source: 'preset', status: overview.contentHash && overview.contentHash !== sceneStoryboardContentHash(scene) ? 'source_changed' : 'adopted' });
  }
  for (const shot of scene?.shots || []) {
    if (shot.imageUrl) references.push({ id: `frame:${shot.id}`, label: `镜头 ${scene!.shots.indexOf(shot) + 1} · 首帧`, mediaKind: 'image', mediaUrl: shot.imageUrl, mediaVersionId: `frame:${shot.id}:${generationHash(shot.imageUrl).slice(0, 16)}`, role: target.kind !== 'scene' && target.shotIds.includes(shot.id) ? 'first_frame' : 'composition', sourceShotIds: [shot.id], enabled: false, locked: false, source: 'preset', status: 'adopted' });
    for (const take of shot.takes || []) if (take.videoUrl) references.push({ id: `motion:${take.id}`, label: `镜头 ${scene!.shots.indexOf(shot) + 1} · 动作参考`, mediaKind: 'video', mediaUrl: take.videoUrl, mediaVersionId: take.id, role: 'motion', sourceShotIds: [shot.id], sourceTakeId: take.id, enabled: false, locked: false, source: 'preset', status: 'candidate' });
  }
  for (const track of scene?.audioTracks || []) if (track.type === 'dialogue' && track.url && (!track.shotId || target.shotIds.includes(track.shotId))) references.push({ id: `dialogue:${track.id}`, label: track.text || '完整对白', mediaKind: 'audio', mediaUrl: track.url, mediaVersionId: `dialogue:${track.id}:${generationHash(track.url).slice(0, 16)}`, role: 'full_dialogue', enabled: false, locked: false, source: 'preset', status: 'adopted' });
  const characterIds = new Set(shots.flatMap(s => [...(s.characterIdsInShot || []), ...(s.dialogueLines || []).flatMap(l => l.characterId ? [l.characterId] : [])]));
  for (const character of project.characters || []) if (characterIds.has(character.id)) for (const ref of character.voiceReferences || []) if (ref.url && ref.usage === 'voice_timbre') references.push({ id: `voice:${ref.id}`, label: `${character.name} · ${ref.isDefault ? '默认' : '历史'}音色参考`, mediaKind: 'audio', mediaUrl: ref.url, mediaVersionId: `voice:${ref.id}:${generationHash(ref.url).slice(0, 16)}`, sourceCharacterId: character.id, role: 'voice_timbre', usageNote: `用于角色「${character.name}」的声音身份；本镜台词以剧本为准。`, enabled: false, locked: false, source: 'preset', status: 'adopted' });
  const suggestedAssets = new Set(workflow?.board && assets ? selectStoryboardCompositeBoardReferences({ project, board: page ? scopeStoryboardCompositeBoardToPage(workflow.board, page) : workflow.board, shots, assets }).selected.map(r => r.boardItemId) : shots.flatMap(s => [...(s.characterIdsInShot || []), s.locationId, ...(s.propIds || [])]));
  for (const ref of references) ref.enabled = requiredLocationReferenceIds.includes(ref.id) || ref.id.startsWith('scene-reference:') || !!ref.sourceAssetId && (suggestedAssets.has(ref.sourceAssetId) || (selectedAssetBoards.some(b => b.boardItemId === ref.sourceAssetId && suggestedAssets.has(b.assetId)) ?? false));
  for(const reference of references)reference.qualityIssue ||= observedReferenceIssue(scene,reference,target.shotIds);
  const voices = (project.characters || []).filter(c => characterIds.has(c.id) && (c.voiceReferences?.length || c.voiceSettings)).map(c => ({ id: c.id, settings: c.voiceSettings, references: c.voiceReferences }));
  const unitVisualPlan=scene ? sceneVisualPlanForShots(scene,target.shotIds) : undefined;
  // Match the visual scope used by video preflight. A local replacement can
  // shadow the episode; assets and other episodes do not inherit this binding.
  let episodeVisualSource: string | null | undefined;
  if (scene && target.kind !== 'asset' && episode?.creativeDirection?.visual) {
    const visualSource = (inheritedEpisode?: Episode) => {
      const visual = resolveProductionCreativeVisual(project, { episode: inheritedEpisode, scene, shot: shots.length === 1 ? shots[0] : undefined });
      return visual ? visualStyleContentHash(visual) : null;
    };
    const current = visualSource(episode);
    if (current !== visualSource()) episodeVisualSource = current;
  }
  // Keep the effective inherited input in every source-hash generation below,
  // including the legacy compatibility fingerprints.
  const relevant = { target, ...(asset?.assetType === 'character' && target.referenceMode !== 'production_board' ? {characterReferencePolicy:'body-face-only.v1'} : {}), basis: sceneContinuityBasis(unitVisualPlan, target.shotIds), shots: shots.map(({ takes, activeTakeId, imageUrl, imageMedia, videoUrl, videoMedia, draftPreview, ...s }) => s), asset: asset?.characterReferenceLayout ? {id:asset.id,sourceHash:characterReferenceSourceHash(project,project.characters.find(c=>c.id===asset.assetId)!,asset.characterReferenceLayout,asset.variantId)} : asset?.locationView ? { id: asset.id, locationViewSourceHash: asset.locationViewSourceHash } : asset || undefined, assetReferences: references.filter(r => r.sourceAssetId), ...(voices.length ? { voices } : {}), projectStyle: { lock: project.visualStyleLock, style: (project as any).visualStyle, creativeDirection: (project as any).creativeDirection }, ...(episodeVisualSource !== undefined ? { episodeVisualSource } : {}), aspectRatio: project.aspectRatio };
  const sourceRevision = episode?.productionRevision || 0;
  let boardSourceHash: string | undefined;
  let prompt = asset ? buildProductionAssetBoardPromptPreview(project, asset, target.referenceMode === 'production_board' ? 'production_board' : 'clean_reference') : shots.map(s => s.imagePrompt || s.visualAction || s.visualSummary || '').filter(Boolean).join('\n\n');
  if (workflow?.board && page && scene && assets) {
    const scoped = scopeStoryboardCompositeBoardToPage(workflow.board, page);
    const refs = selectStoryboardCompositeBoardReferences({ project, board: scoped, shots, assets }).selected;
    prompt = buildStoryboardCompositeBoardPrompt({ project, scene:{...scene,visualPlan:unitVisualPlan}, board: workflow.board, page, shots, references: refs });
    boardSourceHash = buildStoryboardCompositeBoardSourceHash({ project, board: workflow.board, page, shots, references: refs });
  }
  // Panel actions, order and layout are authored inputs in their own right.
  // Keep candidate/adoption state out of the fingerprint, but freeze the same
  // board contract used by the ordinary storyboard review path.
  const assetOwner=asset && [...project.characters,...project.assets].find(item=>item.id===asset.assetId);
  const productionBasis=scene && target.kind!=='asset' ? generationProductionBasis(project,scene,target.shotIds)
    : assetOwner?.productionUse ? {assets:[{id:assetOwner.id,name:assetOwner.name,productionUse:assetOwner.productionUse}]} : undefined;
  const preCollaborationSourceHash=generationHash({ ...relevant, ...(boardSourceHash ? { boardSourceHash } : {}) });
  const sourceHash=productionBasis && Object.keys(productionBasis).length ? generationHash({...relevant,...(boardSourceHash?{boardSourceHash}:{}),productionBasis}) : preCollaborationSourceHash;
  const directionText=productionBasis && Object.keys(productionBasis).length ? '【本单元场面决定】\n'+JSON.stringify(productionBasis) : '';
  const legacySourceHash = boardSourceHash ? generationHash(relevant) : undefined;
  if (target.kind === 'scene' && scene) prompt = [
    '联合设计本次镜头范围的故事板。共同资产只约束身份与环境，不要求每个画格都出现所有资产。按叙事意图选择合理景别和机位；反应、插入、正反打、跳时均可，不要求所有切镜动作无缝。不要把后续事件提前画入前格。',
    directionText, renderSceneContinuityBasis(unitVisualPlan, target.shotIds),
    ...shots.map(s => `镜头 ${scene.shots.indexOf(s) + 1} [${s.id}] · ${s.duration || 0} 秒\n${s.imagePrompt || s.visualAction || s.visualSummary || ''}\n空间调度：${s.blocking || ''}\n状态：${s.continuityNote || ''}\n切镜意图：${s.editingNote || ''}`),
  ].filter(Boolean).join('\n\n');
  if(target.kind!=='scene')prompt=[directionText, target.kind==='shot' ? renderSceneContinuityBasis(unitVisualPlan,target.shotIds) : '',prompt].filter(Boolean).join('\n\n');
  const videoPrompt = scene ? [directionText, renderSceneContinuityBasis(unitVisualPlan, target.shotIds), buildVideoContinuityContext({ sceneId: scene.id, shots: scene.shots, unitShotIds: target.shotIds }), ...shots.map((s, i) => `镜头 ${i + 1}（${s.duration || 0} 秒）：${s.videoPrompt || s.visualAction || s.visualSummary || ''}\n对白：${s.dialogueLines?.map(l => l.text).join('\n') || ''}\n本镜目的：${s.motivation || ''}\n估时与切出：${s.editingNote || ''}`)].filter(Boolean).join('\n\n') : '';
  return { locationViewIssues, requiredLocationReferenceIds, productionBasis, preCollaborationSourceHash, timingReview: scene && target.kind !== 'asset' ? reviewProductionTiming(scene.shots, target.shotIds) : undefined, project, episode, scene, shots, target, workflow, page, asset, references, sourceHash, legacySourceHash, sourceRevision, boardSourceHash, prompt, videoPrompt, narrativeSeconds: shots.reduce((n, s) => n + Number(s.duration || 0), 0), label: asset ? String(asset.assetName || '资产图') : `${scene?.title || '本场'} · ${workflow ? `片段 ${(scene?.manualStoryboard?.boards || []).indexOf(workflow) + 1} · ` : ''}${shots.length} 镜` };
}
