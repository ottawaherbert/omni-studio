import { buildVideoStoryboardAssetBoardPlan } from './videoStoryboardAssetBoards';
import type { Project, Shot } from '../../types/project';
import type { ManualProductionAssetBoard } from './manualProductionAssets';
import { appearanceBoards } from './productionAppearance';
import { renderLocationSpatialAnchor, LOCATION_VIEWS, locationViewCurrentIssue, locationViewImage, locationViewLabels, locationViewSourceHash, locationViewUsage } from './locationViews';

/** Resolve per shot so base and state-variant views cannot be mixed accidentally. */
export function locationViewBoards(project: Project, shots: Shot[], boards: ManualProductionAssetBoard[]): ManualProductionAssetBoard[] {
  const result: ManualProductionAssetBoard[] = [];
  for (const shot of shots) {
    let available = boards;
    if (shot.locationReferenceViews?.length && !boards.some(b => b.assetId === shot.locationId && !b.variantId)) {
      const base = buildVideoStoryboardAssetBoardPlan(project).sceneBoards.find(b => b.assetId === shot.locationId);
      if (base) available = [...boards, { boardItemId: base.id, assetId: base.assetId, assetType: 'location', assetName: base.assetName,
        boardKind: base.boardKind, prompt: base.prompt || '', promptHash: '', referenceImageUrl: base.referenceImageUrl,
        referenceSource: base.referenceImageUrl ? 'canonical' : 'missing', referenceOrigin: 'existing',
        requiredDepartments: [], sourceDepartmentPackageIds: [], departmentBlockers: [], approvalState: 'needs_confirmation', usageRefs: [] }];
    }
    const scoped = [...available.filter(b => b.assetType !== 'location'), ...appearanceBoards(project, [shot], available, 'image').filter(b => b.assetType === 'location')];
    const locationHasState = scoped.some(b => b.assetId === shot.locationId && b.variantId);

    for (const board of scoped) {
      if (board.assetType === 'location' && (board.assetId !== shot.locationId || shot.locationReferenceViews?.length && locationHasState && !board.variantId)) continue;
      if (board.assetType !== 'location' || !shot.locationReferenceViews?.length) { result.push(board); continue; }
      const asset = project.assets.find(a => a.id === board.assetId);
      if (!asset) continue;
      const state = shot.appearance?.states.find(s => s.assetId === board.assetId && s.decision === 'accepted');
      // appearanceBoards can use a base identity while a state image is missing.
      // An explicitly selected state view must retain its state identity instead.
      const variantId = state ? (state.imageMoment === 'end' ? state.endVariantId : state.startVariantId) : board.variantId;
      for (const view of shot.locationReferenceViews) {
        if (!LOCATION_VIEWS.includes(view)) throw new Error('场景参考视角无效。');
        const issue = view === 'main' ? undefined : locationViewCurrentIssue(project, asset, view, variantId);
        const referenceImageUrl = locationViewImage(asset, view, variantId);
        result.push({ ...board, boardItemId: `location-view:${asset.id}:${variantId || 'base'}:${view}`, variantId, locationView: view,
          assetName: `${board.assetName} · ${locationViewLabels[view]}`, referenceImageUrl,
          prompt: [locationViewUsage(view), renderLocationSpatialAnchor(asset, view, variantId)].filter(Boolean).join('\n'), promptHash: view === 'main' ? board.promptHash : locationViewSourceHash(project, asset, view, variantId),
          locationViewIssue: issue, approvalState: issue ? 'stale' : board.approvalState,
          referenceSource: referenceImageUrl ? variantId ? 'variant' : 'canonical' : 'missing' });
      }
    }
  }
  return result.filter((b, i, list) => list.findIndex(x => x.boardItemId === b.boardItemId) === i);
}
