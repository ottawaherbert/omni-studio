import { sha256 } from "js-sha256";
import type { AudioTrack, Episode, Project, Scene, Shot } from "../../../../../src/types/project";
import type { SceneDirectorPlan, ShotDirecting } from "../../../../domain/src/directorPlan";
import { resolveCreativeRole, renderDirectorDirection, isDirectorProfileV2, directorFields, directorFieldValues, type CreativeStage } from "../../../../domain/src/creativeDirection";
import { productionCreativeScopes, type ProductionCreativeScope } from "./creativeScopes";
import { manualFilmTeamSceneSource } from "../../../../../src/services/production/manualFilmTeam";
import { visualStyleContentHash } from "./visualStyleMigration";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const uniq = (values: Array<string | undefined>) => [...new Set(values.filter((v): v is string => Boolean(v)))];

export function directorBindingHash(project: Partial<Project>, scope: ProductionCreativeScope = {}) {
  const role = resolveCreativeRole(productionCreativeScopes(project, scope), "director");
  return sha256(JSON.stringify(role.enabled ? { skill: role.skill, notes: role.notes } : { enabled: false }));
}

/** Only dependencies actually used by this scene; unrelated asset edits do not invalidate it. */
export function directorPlanSourceHash(project: Partial<Project>, scope: ProductionCreativeScope, assetIds: string[]) {
  const scene = scope.scene;
  const visual = resolveCreativeRole(productionCreativeScopes(project, { ...scope, shot: undefined }), "visual");
  const scenes = (scope.episode as Episode | undefined)?.scenes || [];
  const index = scenes.findIndex(item => item.id === scene?.id);
  const adjacent = index < 0 ? [] : scenes.slice(Math.max(0, index - 1), index + 2).filter(item => item.id !== scene?.id);
  return sha256(JSON.stringify({
    binding: directorBindingHash(project, { ...scope, shot: undefined }),
    script: scene ? manualFilmTeamSceneSource(scene).text : "", targetDuration: scene?.targetDuration,
    visual: visual.enabled ? { skill: visual.skill, notes: visual.notes } : visual.source === "未设置" ? (project.visualStyleLock ? { content: visualStyleContentHash(project.visualStyleLock), rejected: project.visualStyleLock.humanApprovalState === "rejected" } : project.creativeVision?.visualStyle) : null,
    assets: [...assetIds].sort().map(id => {
      const owner = [...(project.characters || []), ...(project.assets || [])].find(item => item.id === id);
      return owner ? { id, name: owner.name, visual: "type" in owner ? owner.description : owner.visualIdentity, acting: "type" in owner ? undefined : owner.actingStyle, speech: "type" in owner ? undefined : owner.vocalQuirk } : { id, missing: true };
    }),
    adjacent: adjacent.map(item => ({ id: item.id, script: manualFilmTeamSceneSource(item).text, intent: item.manualStoryboard?.directorPlan?.intent, rhythm: item.manualStoryboard?.directorPlan?.rhythm })),
  }));
}

export function directorPlanStatus(project: Partial<Project>, scope: ProductionCreativeScope) {
  const plan = scope.scene?.manualStoryboard?.directorPlan;
  if (!plan) return "missing" as const;
  if ((scope.shot?.directing?.bindingHash || plan.bindingHash) !== directorBindingHash(project, scope)) return "director_changed" as const;
  if (!scope.shot && scope.scene?.shots?.some(shot => shot.directing?.planId === plan.id && shot.directing.bindingHash !== directorBindingHash(project, { ...scope, shot }))) return "director_changed" as const;
  if (plan.sourceHash !== directorPlanSourceHash(project, scope, plan.assetIds)) return "source_changed" as const;
  return "current" as const;
}

/** Resolve once against the request snapshot. The model cannot choose provenance or IDs. */
export function normalizeDirectorPlan(input: {
  project: Partial<Project>; episode?: Episode; scene: Scene; rawShots: unknown[]; shots: Shot[]; now?: number;
}): { plan?: SceneDirectorPlan; shots: Shot[]; issues: string[] } {
  const { project, episode, scene, rawShots } = input;
  const scope = { episode, scene };
  const role = resolveCreativeRole(productionCreativeScopes(project, scope), "director");
  const issues: string[] = [];
  // New shot IDs remain independent of archived media. Only an explicit, valid
  // correspondence can carry the author's local settings into a redesigned shot.
  const authoredShots = input.shots.map((shot, index) => {
    const sourceId = text(record(rawShots[index]).sourceShotId) || text(record(record(rawShots[index]).directing).sourceShotId);
    const source = scene.shots?.find(item => item.id === sourceId);
    if (sourceId && !source) issues.push(`镜头 ${index + 1} 对应的原镜头不存在，未继承局部设置。`);
    return source?.creativeDirection ? { ...shot, creativeDirection: structuredClone(source.creativeDirection) } : shot;
  });
  const shotRoles = authoredShots.map(shot => resolveCreativeRole(productionCreativeScopes(project, { ...scope, shot }), "director"));
  const activeRole = role.enabled ? role : shotRoles.find(item => item.enabled);
  const raw = rawShots.map(record).find(shot => Object.keys(record(shot.directorPlan)).length)?.directorPlan;
  const value = record(raw);
  const assetIds = uniq(input.shots.flatMap(shot => [...(shot.characterIdsInShot || []), ...(shot.propIds || []), shot.locationId]));
  let plan: SceneDirectorPlan | undefined;
  if (activeRole && text(value.intent)) {
    const sourceHash = directorPlanSourceHash(project, scope, assetIds);
    const methodSource = [role, ...shotRoles].filter(item => item.enabled).map(item => renderDirectorDirection(item, "planning")).filter(Boolean).join("\n");
    const script = manualFilmTeamSceneSource(scene).text;
    const applications = list(value.applications).flatMap((rawApplication, index) => {
      const application = record(rawApplication);
      const method = text(application.method), evidence = text(application.evidence), decision = text(application.decision);
      const ordinals = list(application.shotNumbers);
      const shotIds = uniq(ordinals.map(number => Number.isInteger(number) ? input.shots[number - 1]?.id : undefined));
      if (!method || !decision || !shotIds.length) { issues.push(`导演方法 ${index + 1} 缺少方法、拍法或有效镜头落点。`); return []; }
      if (ordinals.some(number => !Number.isInteger(number) || !input.shots[number - 1])) issues.push(`导演方法 ${index + 1} 引用了不存在的镜头序号。`);
      if (!methodSource.includes(method)) issues.push(`导演方法 ${index + 1} 的摘录未在本次 Skill 中找到，请核对。`);
      if (!evidence || !script.includes(evidence)) issues.push(`导演方法 ${index + 1} 的原文依据未逐字匹配，请核对。`);
      const methodId = text(application.methodId), skillId = text(application.skillId);
      const sources = [role, ...shotRoles].filter(item => item.enabled && (!skillId || item.skill?.id === skillId));
      const matches = sources.flatMap(item => isDirectorProfileV2(item.skill?.profile?.director) ? item.skill.profile.director.methods.filter(rule => rule.id === methodId).map(rule => ({ rule, skillId: item.skill?.id })) : []);
      const unique = [...new Map(matches.map(item => [item.skillId + ":" + item.rule.id, item])).values()];
      const match = unique.length === 1 ? unique[0] : undefined;
      const dimensions = list(application.dimensions).filter((path): path is typeof directorFields[number] => directorFields.includes(path) && !!match && directorFieldValues(match.rule.directions, path).length > 0);
      if (list(application.dimensions).length !== dimensions.length) issues.push(`导演方法 ${index + 1} 含未提供的指导字段，请核对。`);
      if (methodId && !match) issues.push(`导演方法 ${index + 1} 的来源标识无效，保留为待核对说明。`);
      return [{ method, evidence, decision, shotIds, ...(match ? { methodId, skillId: match.skillId, dimensions, status: "planned" as const } : {}) }];
    });
    plan = {
      schemaVersion: "scene-director.v1", id: "direction-" + sha256(JSON.stringify({ sourceHash, value, shotIds: input.shots.map(shot => shot.id) })).slice(0, 24),
      bindingHash: directorBindingHash(project, scope), sourceHash, assetIds,
      skillId: activeRole.skill?.id, skillTitle: activeRole.skill?.title || "自定义导演", skillRevision: activeRole.skill?.revision,
      intent: text(value.intent), rhythm: text(value.rhythm), applications,
      exceptions: list(value.exceptions).map(text).filter(Boolean), createdAt: input.now ?? Date.now(),
    };
    if (!applications.length && !plan.exceptions.length) issues.push("本场导演方案没有说明采用的方法或不适用原因。");
  } else if (activeRole) issues.push("此次返回没有本场导演方案，镜头仍可采用；尚未记录导演方法的具体落点。");

  const total = input.shots.reduce((sum, shot) => sum + (shot.duration || 0), 0);
  let offset = 0;
  const shots = authoredShots.map((shot, index) => {
    const rawDirection = record(record(rawShots[index]).directing);
    const dialogue: ShotDirecting["dialogue"] = [];
    for (const item of list(rawDirection.dialogue)) {
      const line = record(item), lineIndex = line.lineIndex;
      if (!Number.isInteger(lineIndex) || lineIndex < 0 || !shot.dialogueLines?.[lineIndex] || dialogue.some(value => value.lineIndex === lineIndex)) {
        issues.push(`镜头 ${index + 1} 的台词导演要求引用了无效或重复行号。`); continue;
      }
      const startSeconds = line.startSeconds;
      const validStart = startSeconds === undefined || (typeof startSeconds === "number" && Number.isFinite(startSeconds) && offset + startSeconds >= 0 && offset + startSeconds < total);
      if (!validStart) issues.push(`镜头 ${index + 1} 的台词进入点超出本场时长，保留原排布。`);
      dialogue.push({ lineIndex, instruction: text(line.instruction), ...(startSeconds !== undefined && validStart ? { startSeconds } : {}) });
    }
    const soundCues: ShotDirecting["soundCues"] = [];
    for (const [cueIndex, item] of list(rawDirection.soundCues).entries()) {
      const cue = record(item);
      if (!["sfx", "bgm"].includes(cue.type) || !text(cue.description) || !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.durationSeconds) || cue.durationSeconds <= 0 || offset + cue.startSeconds < 0 || offset + cue.startSeconds + cue.durationSeconds > total + 0.001) {
        issues.push(`镜头 ${index + 1} 的声音事件 ${cueIndex + 1} 缺少有效内容或超出本场时长，未排入轨道。`); continue;
      }
      const asset = (project.assets || []).find(asset => asset.id === cue.linkedAssetId && asset.type === cue.type);
      if (cue.linkedAssetId && !asset) issues.push(`镜头 ${index + 1} 的声音引用未匹配到项目资产，保留为待制作声音。`);
      soundCues.push({ id: `${shot.id}-cue-${cueIndex + 1}`, type: cue.type, description: text(cue.description), startSeconds: cue.startSeconds, durationSeconds: cue.durationSeconds, ...(asset ? { linkedAssetId: asset.id } : {}) });
    }
    offset += shot.duration || 0;
    const shotRole = resolveCreativeRole(productionCreativeScopes(project, { ...scope, shot }), "director");
    const sourceId = text(record(rawShots[index]).sourceShotId) || text(rawDirection.sourceShotId);
    const sourceShotId = scene.shots?.some(item => item.id === sourceId) ? sourceId : undefined;
    return { ...shot, directing: plan || dialogue.length || soundCues.length || sourceShotId ? { ...(sourceShotId ? { sourceShotId } : {}), planId: plan?.id, bindingHash: directorBindingHash(project, { ...scope, shot }), skillId: shotRole.skill?.id, skillTitle: shotRole.enabled ? shotRole.skill?.title || "自定义导演" : "本镜未使用导演 Skill", skillRevision: shotRole.skill?.revision, dialogue, soundCues } : undefined };
  });
  return { plan, shots, issues };
}

export function directorShotInstruction(shot: Shot, stage: CreativeStage, title: string, lineIndex?: number) {
  const fields: Array<[string, string | undefined]> = stage === "image" ? [
    ["景别", shot.shotSize], ["机位", shot.cameraAngle], ["焦段", shot.focalLength], ["构图", shot.composition], ["人物位置与视线", shot.blocking], ["当前动作", shot.visualAction], ["表演", shot.microExpression], ["光线", shot.lighting || shot.lightingAtmo],
  ] : stage === "video" ? [
    ["景别", shot.shotSize], ["机位", shot.cameraAngle], ["构图", shot.composition], ["运镜", shot.cameraMovement], ["调度", shot.blocking], ["动作", shot.visualAction], ["表演", shot.microExpression], ["光线", shot.lighting || shot.lightingAtmo], ["承接", shot.continuityNote],
  ] : stage === "performance" ? [] : ["music", "sfx"].includes(stage) ? [] : stage === "sound" ? [["声音设计", shot.soundDesign]] : [["剪辑意图", shot.editingNote], ["声音设计", shot.soundDesign]];
  const dialogue = ["performance", "video", "review"].includes(stage) ? (shot.directing?.dialogue || []).filter(line => lineIndex === undefined || line.lineIndex === lineIndex).map(line => `第 ${line.lineIndex + 1} 句表演：${line.instruction}`).filter(line => !line.endsWith("：")) : [];
  const cues = ["sound", "music", "sfx", "editing", "video", "review"].includes(stage) ? (shot.directing?.soundCues || []).filter(cue => stage !== "music" && stage !== "sfx" || cue.type === (stage === "music" ? "bgm" : "sfx")).map(cue => `${cue.type === "bgm" ? "音乐" : "音效"}：${cue.description}；相对本镜 ${cue.startSeconds} 秒进入，持续 ${cue.durationSeconds} 秒`) : [];
  return [
    `【采用的镜头拍法：${title}】`, ...fields.filter(([, value]) => value?.trim()).map(([label, value]) => `${label}：${value}`),
    ...dialogue, ...cues,
    stage === "image" ? "呈现本镜一个明确时刻；外观起终态以当前外观指令为准。" : "",
    stage === "video" ? `本镜剪辑时长 ${shot.duration || 0} 秒；保持已定动作顺序。声音仅在所选生成能力支持时实现，独立音轨按声音方案制作。` : "",
    stage === "performance" ? "只执行当前台词的表演要求，保留原文和已定音色；作者本句要求优先。" : "",
  ].filter(Boolean).join("\n");
}

/** Build actual track positions. No generated audio is claimed by an empty track. */
export function applyDirectorAudioPlan(shots: Shot[], tracks: AudioTrack[]): { tracks: AudioTrack[]; issues: string[] } {
  const total = shots.reduce((sum, shot) => sum + (shot.duration || 0), 0);
  const offsets = new Map<string, number>();
  let elapsed = 0;
  for (const shot of shots) { offsets.set(shot.id, elapsed); elapsed += shot.duration || 0; }
  const issues: string[] = [];
  const usedLines = new Map<string, Set<number>>();
  const result = tracks.map(track => {
    const shot = shots.find(shot => shot.id === track.shotId);
    if (!shot || track.type !== "dialogue") return track;
    const used = usedLines.get(shot.id) || new Set<number>();
    const index = shot.dialogueLines?.findIndex((line, i) => !used.has(i) && line.text === track.text && (line.characterId || line.speakerName) === (track.characterId || track.speakerName)) ?? -1;
    used.add(index); usedLines.set(shot.id, used);
    const direction = shot.directing?.dialogue.find(line => line.lineIndex === index);
    if (!direction) return track;
    const startTime = direction.startSeconds === undefined ? track.startTime : (offsets.get(shot.id) || 0) + direction.startSeconds;
    const fits = startTime >= 0 && startTime + track.duration <= total + 0.001;
    if (!fits) issues.push(`镜头 ${shots.indexOf(shot) + 1} 第 ${index + 1} 句按原时长无法放入导演进入点，保留原排布。`);
    return { ...track, startTime: fits ? startTime : track.startTime, directorCue: { planId: shot.directing?.planId, lineIndex: index } };
  });
  const orderedDialogue = tracks.flatMap((track, index) => track.type === "dialogue" ? [{ track, index }] : []).sort((a, b) => a.track.startTime - b.track.startTime);
  if (orderedDialogue.some((item, index) => index > 0 && result[item.index].startTime < result[orderedDialogue[index - 1].index].startTime)) {
    issues.push("台词进入点会改变原对白先后顺序，保留原排布。");
    orderedDialogue.forEach(({ track, index }) => { result[index] = { ...result[index], startTime: track.startTime }; });
  }
  for (const shot of shots) for (const cue of shot.directing?.soundCues || []) {
    if (result.some(track => track.directorCue?.cueId === cue.id)) continue;
    const startTime = (offsets.get(shot.id) || 0) + cue.startSeconds;
    if (!Number.isFinite(startTime) || !Number.isFinite(cue.durationSeconds) || startTime < 0 || cue.durationSeconds <= 0 || startTime + cue.durationSeconds > total + 0.001) {
      issues.push(`镜头 ${shots.indexOf(shot) + 1} 的声音事件超出当前场次时长，未排入轨道。`); continue;
    }
    result.push({ id: "director-audio-" + cue.id, type: cue.type, url: "", text: cue.description,
      startTime, duration: cue.durationSeconds, shotId: shot.id,
      linkedAssetId: cue.linkedAssetId, directorCue: { planId: shot.directing?.planId, cueId: cue.id } });
  }
  return { tracks: result, issues };
}

export function directorDialogueIndex(shot: Shot | undefined, track: AudioTrack): number | undefined {
  const index = track.directorCue?.lineIndex;
  if (index !== undefined && shot?.dialogueLines?.[index]?.text === track.text) return index;
  const matches = (shot?.dialogueLines || []).flatMap((line, i) => line.text === track.text && (line.characterId || line.speakerName) === (track.characterId || track.speakerName) ? [i] : []);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Revalidate author edits before adoption; do not silently drop invalid sound events. */
export function validateDirectorShotEdits(shots: Shot[], audio?: { previous: Shot[]; tracks: AudioTrack[] }): string[] {
  const issues: string[] = [];
  const total = shots.reduce((sum, shot) => sum + (shot.duration || 0), 0);
  let offset = 0;
  for (const [index, shot] of shots.entries()) {
    if (!Number.isFinite(shot.duration) || shot.duration <= 0) issues.push(`镜头 ${index + 1} 需要大于 0 的时长。`);
    for (const line of shot.directing?.dialogue || []) {
      if (!shot.dialogueLines?.[line.lineIndex]) issues.push(`镜头 ${index + 1} 的表演要求对应台词已不存在。`);
      if (line.startSeconds !== undefined && (!Number.isFinite(line.startSeconds) || offset + line.startSeconds < 0 || offset + line.startSeconds >= total)) issues.push(`镜头 ${index + 1} 的台词进入时间超出本场。`);
    }
    for (const cue of shot.directing?.soundCues || []) {
      if (!cue.description.trim() || !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.durationSeconds) || cue.durationSeconds <= 0 || offset + cue.startSeconds < 0 || offset + cue.startSeconds + cue.durationSeconds > total + 0.001) issues.push(`镜头 ${index + 1} 的声音事件需要有效内容和本场范围内的时间。`);
    }
    offset += shot.duration || 0;
  }
  if (audio) {
    const next = reconcileDirectorAudioEdits(audio.previous, shots, audio.tracks);
    const previousTotal = audio.previous.reduce((sum, shot) => sum + (shot.duration || 0), 0);
    const changed = next.filter(track => { const before = audio.tracks.find(item => item.id === track.id); return before && (track.startTime !== before.startTime || track.duration !== before.duration); });
    const affected = next.filter(track => changed.includes(track) || (total < previousTotal && track.startTime + track.duration > total && track.startTime + track.duration <= previousTotal + 0.001));
    for (const track of affected) {
      if (track.startTime < 0 || track.startTime + track.duration > total + 0.001) issues.push(track.type === "dialogue" ? "台词进入时间无法容纳已有录音时长，请调整进入时间或镜头时长。" : "调整后音乐或音效将超出本场时间，请先核对声音的进入点和时长。");
    }
    if (changed.some(track => track.type === "dialogue")) {
      const ordered = audio.tracks.filter(track => track.type === "dialogue").sort((a, b) => a.startTime - b.startTime).flatMap(track => { const retained = next.find(item => item.id === track.id); return retained ? [retained] : []; });
      if (ordered.some((track, index) => index > 0 && track.startTime < ordered[index - 1].startTime)) issues.push("台词进入时间会改变已有对白顺序，请核对后再保存。");
    }
  }
  return issues;
}

/** Sync only changed author decisions; leave unrelated manual timeline edits and media intact. */
export function reconcileDirectorAudioEdits(previous: Shot[], shots: Shot[], tracks: AudioTrack[]): AudioTrack[] {
  const offsets = (items: Shot[]) => { let time = 0; return new Map(items.map(shot => { const start = time; time += shot.duration || 0; return [shot.id, start] as const; })); };
  const beforeOffsets = offsets(previous), afterOffsets = offsets(shots);
  const oldCueIds = new Set(previous.flatMap(shot => shot.directing?.soundCues.map(cue => cue.id) || []));
  const currentCueIds = new Set(shots.flatMap(shot => shot.directing?.soundCues.map(cue => cue.id) || []));
  let result = tracks.filter(track => (!track.shotId || !beforeOffsets.has(track.shotId) || afterOffsets.has(track.shotId))
    && (!track.directorCue?.cueId || !oldCueIds.has(track.directorCue.cueId) || currentCueIds.has(track.directorCue.cueId)))
    .map(track => {
      if (!track.shotId || !beforeOffsets.has(track.shotId) || !afterOffsets.has(track.shotId)) return track;
      const delta = afterOffsets.get(track.shotId)! - beforeOffsets.get(track.shotId)!;
      return delta ? { ...track, startTime: track.startTime + delta } : track;
    });
  for (const shot of shots) {
    const old = previous.find(item => item.id === shot.id);
    for (const cue of shot.directing?.soundCues || []) {
      const oldCue = old?.directing?.soundCues.find(item => item.id === cue.id);
      if (JSON.stringify(oldCue) === JSON.stringify(cue)) continue;
      const patch = { type: cue.type, text: cue.description, startTime: (afterOffsets.get(shot.id) || 0) + cue.startSeconds, duration: cue.durationSeconds, shotId: shot.id, linkedAssetId: cue.linkedAssetId, directorCue: { planId: shot.directing?.planId, cueId: cue.id } };
      const existing = result.find(track => track.directorCue?.cueId === cue.id);
      if (existing) result = result.map(track => track.id === existing.id ? {
        ...track,
        ...(!oldCue || oldCue.type !== cue.type ? { type: patch.type } : {}),
        ...(!oldCue || oldCue.description !== cue.description ? { text: patch.text } : {}),
        ...(!oldCue || oldCue.startSeconds !== cue.startSeconds ? { startTime: patch.startTime } : {}),
        ...(!oldCue || oldCue.durationSeconds !== cue.durationSeconds ? { duration: patch.duration } : {}),
        ...(!oldCue || oldCue.linkedAssetId !== cue.linkedAssetId ? { linkedAssetId: patch.linkedAssetId } : {}),
        shotId: shot.id, directorCue: patch.directorCue,
      } : track);
      else result.push({ id: "director-audio-" + cue.id, url: "", ...patch });
    }
    result = result.map(track => {
      if (track.type !== "dialogue" || track.shotId !== shot.id) return track;
      const index = directorDialogueIndex(shot, track);
      const line = shot.directing?.dialogue.find(item => item.lineIndex === index);
      const before = old?.directing?.dialogue.find(item => item.lineIndex === index);
      if (line?.startSeconds === undefined || before?.startSeconds === line.startSeconds) return track;
      return { ...track, startTime: (afterOffsets.get(shot.id) || 0) + line.startSeconds, directorCue: { ...track.directorCue, planId: shot.directing?.planId, lineIndex: index } };
    });
  }
  return result;
}
