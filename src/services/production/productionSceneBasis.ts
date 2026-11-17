import type { Project, Scene } from '../../types/project';
import { sceneProductionAssets } from './productionCollaboration';
import { manualFilmTeamSceneSource } from './manualFilmTeam';

/** Shared, read-only production decisions. Never starts review or generation. */
export function productionSceneBasis(project: Partial<Project>, scene: Scene) {
  const snapshot = project.productionSourceSnapshot;
  const source = snapshot?.sourceType === 'writing_export'
    ? snapshot.package.units.find(unit => unit.id === scene.sourceWritingUnitId)?.scenes?.find(item => item.id === scene.sourceWritingSceneId)
    : undefined;
  const sourceCurrent = source
    ? source.blocks.map(block => block.content).join('').replace(/\s+/g, '') === manualFilmTeamSceneSource(scene).text.replace(/\s+/g, '')
    : undefined;
  const plan = scene.manualStoryboard?.directorPlan;
  const assets = sceneProductionAssets(project, scene);
  return {
    ...(assets.length ? { assets } : {}),
    ...(scene.breakdown?.beats?.length ? { beats: scene.breakdown.beats } : {}),
    ...(source ? { upstream: {
      sourceCurrent,
      // A changed production script must not inherit stale upstream facts.
      ...(sourceCurrent ? { facts: {
        purpose: source.purpose, goal: source.goal, obstacle: source.obstacle,
        turn: source.turn, performanceNotes: source.performanceNotes,
        continuityIn: source.continuityIn, continuityOut: source.continuityOut,
        beats: source.beats,
      } } : {}),
    } } : {}),
    ...(plan ? { direction: { intent: plan.intent, rhythm: plan.rhythm,
      requirements: plan.requirements, beatDirections: plan.beatDirections, assumptions: plan.assumptions,
      decisions: plan.applications.map(item => ({ decision: item.decision, shotIds: item.shotIds })),
      exceptions: plan.exceptions,
    } } : {}),
    ...(scene.visualPlan ? { continuity: {
      geography: scene.visualPlan.geography, lighting: scene.visualPlan.lighting,
      entryState: scene.visualPlan.entryState, exitState: scene.visualPlan.exitState,
      transition: scene.visualPlan.transition, eventStates: scene.visualPlan.eventStates,
    } } : {}),
  };
}

/** Freeze only decisions relevant to the selected generation unit. */
export function generationProductionBasis(project: Partial<Project>, scene: Scene, shotIds: string[]) {
  const basis=productionSceneBasis(project,scene);
  const shots=(scene.shots||[]).filter(s=>shotIds.includes(s.id));
  const targets=new Set([scene.id,...shotIds,...shots.flatMap(s=>[...(s.characterIdsInShot||[]),...(s.propIds||[]),...(s.vehicleIds||[]),...(s.dialogueLines||[]).flatMap(l=>l.characterId?[l.characterId]:[]),s.locationId])]);
  const direction=basis.direction;
  const beatIds=new Set([...shots.flatMap(s=>s.beatIds||[]),...(direction?.beatDirections||[]).filter(b=>b.shotIds?.some(id=>shotIds.includes(id))).map(b=>b.beatId)]);
  const allShots=shots.length===(scene.shots||[]).length;
  const relevantBeat=(ids?:string[])=>!ids?.length || allShots || ids.some(id=>beatIds.has(id));
  const beats=basis.beats?.filter(b=>allShots || beatIds.has(b.id));
  return {
    ...(beats?.length?{beats}:{}),
    ...(basis.upstream?{upstream:basis.upstream}:{}),
    ...(direction?{direction:{...direction,
      decisions:direction.decisions.filter(d=>!d.shotIds.length||d.shotIds.some(id=>shotIds.includes(id))),
      requirements:direction.requirements?.filter(r=>(!r.targetIds?.length||r.targetIds.some(id=>targets.has(id)))&&relevantBeat(r.beatIds)),
      beatDirections:direction.beatDirections?.filter(b=>b.shotIds?.length ? b.shotIds.some(id=>shotIds.includes(id)) : relevantBeat([b.beatId])),
    }}:{}),
    ...(basis.assets?.some(a=>targets.has(a.id))?{assets:basis.assets.filter(a=>targets.has(a.id))}:{}),
  };
}
