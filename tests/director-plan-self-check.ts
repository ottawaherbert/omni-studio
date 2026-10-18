import assert from "node:assert/strict";
import { normalizeDirectorPlan, directorBindingHash, directorPlanStatus, applyDirectorAudioPlan, directorDialogueIndex } from "../packages/production/src/services/production/directorPlan";
import { renderProductionCreativeContext, creativeExecutionManifest, projectDirectorMediaContext } from "../packages/production/src/services/production/creativeDirection";
import { buildProductionSceneContext } from "../src/services/production/productionSceneContext";
import { snapshotCreativeSkill } from "../packages/domain/src/creativeDirection";
import { buildCreativeSkillDraftPrompt } from "../packages/domain/src/creativeSkillDraft";
import { assetDesignContext } from "../src/services/production/productionAssetDesign";
import { buildImageVisualStyleProjection, buildProductionAssetImageVisualStyleProjection } from "../src/services/production/imageVisualStyleProjection";
import { compileImageGenerationRequest } from "../src/services/production/imageGenerationRequest";
import { buildStudioShotVideoVisualStyleProjection } from "../src/services/production/studioShotVisualStyle";
import { buildEpisodeAudioExportItems } from "../src/utils/episodeAudioExport";
import { buildManualShotPlanHash } from "../src/services/production/manualStoryboard";
import { directorPlanContract, upgradeDirectorPlanTemplate } from "../src/config/prompts/directorPlanContract";
import type { AudioTrack, Episode, Project, Scene, Shot } from "../src/types/project";

const method = "保留双人中景，在听者反应之后切镜。";
const unrelatedMethod = "在有相应情节的动作戏使用快速跟拍。";
const skill = snapshotCreativeSkill({ id: "director-a", title: "观察人物关系", kind: "director", revision: 3, content: method + unrelatedMethod, source: "manual", createdAt: 1, updatedAt: 1 });
const scene = { id: "scene-a", title: "会议", script: "阿青看着阿林。阿青：等一下。阿林：我听着。", targetDuration: 1 / 6, shots: [] } as unknown as Scene;
const nextScene = { id: "scene-b", title: "离开", script: "阿青离开房间。", shots: [] } as unknown as Scene;
const episode = { id: "episode-a", scenes: [scene, nextScene] } as Episode;
const project = { id: "project-a", characters: [{ id: "qing", name: "阿青", visualIdentity: "短发，白衬衣" }, { id: "lin", name: "阿林", visualIdentity: "长发，灰衣" }, { id: "unused", name: "未出场角色" }], assets: [{ id: "room", type: "location", name: "会议室", description: "灰墙，长桌" }, { id: "ambient", type: "sfx", name: "室内环境声" }], episodes: [episode], creativeDirection: { director: { mode: "replace", skill } } } as unknown as Project;
const shots: Shot[] = [
  { id: "shot-a", duration: 5, shotSize: "双人中景", cameraAngle: "平视", composition: "双人同框", blocking: "阿青面向阿林", cameraMovement: "固定", visualAction: "阿青看着阿林", microExpression: "目光停在听者脸上", soundDesign: "房间原有的环境声", characterIdsInShot: ["qing", "lin"], locationId: "room", dialogueLines: [{ characterId: "qing", text: "等一下。" }] },
  { id: "shot-b", duration: 5, shotSize: "近景", cameraAngle: "平视", cameraMovement: "固定", visualAction: "阿林抬眼回应", characterIdsInShot: ["lin"], locationId: "room", dialogueLines: [{ characterId: "lin", text: "我听着。" }], editingNote: "回应后切镜", transition: "none" },
];
const raw: Array<Record<string, any>> = [
  { directorPlan: { intent: "保持两人的观看关系", rhythm: "先观察，再在回应时收近；下一场顺接离开", applications: [{ method, evidence: "阿青看着阿林。", decision: "先双人同框，再留听者近景", shotNumbers: [1, 2] }], exceptions: ["当前没有动作戏，不采用快速跟拍"] }, directing: { dialogue: [{ lineIndex: 0, instruction: "轻声提醒，句尾停顿" }], soundCues: [{ type: "sfx", description: "连续的室内环境声", startSeconds: 0, durationSeconds: 10, linkedAssetId: "ambient" }] } },
  { directing: { dialogue: [{ lineIndex: 0, instruction: "平静回应", startSeconds: -1 }], soundCues: [] } },
];
const normalized = normalizeDirectorPlan({ project, episode, scene, rawShots: raw, shots, now: 10 });
assert.deepEqual(normalized.issues, []);
assert.equal(normalized.plan?.skillRevision, 3);
assert.deepEqual(normalized.plan?.applications[0].shotIds, ["shot-a", "shot-b"]);
scene.shots = normalized.shots;
scene.manualStoryboard = { schemaVersion: "manual-storyboard.v1", directorPlan: normalized.plan, updatedAt: 10 };
assert.equal(directorPlanStatus(project, { episode, scene }), "current");
const scope = { episode, scene, shot: scene.shots[0] };
const image = buildImageVisualStyleProjection({ project, intent: "final_frame", creativeScope: scope });
const compiled = compileImageGenerationRequest({ promptCore: "阿青与阿林在会议室。", visualStyleProjection: image });
assert.ok(compiled.providerPrompt.includes("双人同框"));
assert.ok(!compiled.providerPrompt.includes(unrelatedMethod));
assert.ok(!compiled.providerPrompt.includes("轻声提醒"));
assert.ok(!compiled.providerPrompt.includes("先观察，再"));
const video = buildStudioShotVideoVisualStyleProjection({ project, ...scope });
assert.ok(video.rendered.instruction.includes("运镜：固定"));
assert.ok(video.rendered.instruction.includes("连续的室内环境声"));
assert.ok(!video.rendered.instruction.includes(unrelatedMethod));
assert.deepEqual(creativeExecutionManifest(project, scope, "video")?.appliedMethods, [method]);
const projectedContext = JSON.parse(projectDirectorMediaContext(JSON.stringify(buildProductionSceneContext(episode, scene, [], project)), project, { episode, scene }, "image"));
assert.equal(projectedContext.currentScene.source, scene.script);
assert.equal(projectedContext.directingAcrossScenes, undefined);
assert.equal(projectedContext.historicalPlans, undefined);
assert.ok(!projectedContext.creativeDirection.includes(unrelatedMethod));
assert.equal(projectDirectorMediaContext("作者自由文本", project, scope, "image"), "作者自由文本");

const baseTracks: AudioTrack[] = [
  { id: "voice-a", type: "dialogue", url: "", startTime: 0, duration: 1.5, characterId: "qing", text: "等一下。", shotId: "shot-a" },
  { id: "voice-b", type: "dialogue", url: "", startTime: 5, duration: 2, characterId: "lin", text: "我听着。", shotId: "shot-b", voiceDirection: { instructions: "作者指定更轻" } },
];
const audio = applyDirectorAudioPlan(scene.shots, baseTracks);
assert.deepEqual(audio.issues, []);
assert.equal(audio.tracks[1].startTime, 4); // Actual J-cut position, not a prose suggestion.
assert.equal(audio.tracks[1].voiceDirection?.instructions, "作者指定更轻");
assert.equal(audio.tracks[2].startTime, 0);
assert.equal(audio.tracks[2].duration, 10);
assert.equal(audio.tracks[2].url, "");
assert.equal(applyDirectorAudioPlan(scene.shots, audio.tracks).tracks.length, 3);
const reordered = structuredClone(scene.shots);
reordered[0].directing!.dialogue[0].startSeconds = 6;
const protectedOrder = applyDirectorAudioPlan(reordered, baseTracks);
assert.equal(protectedOrder.tracks[0].startTime, 0);
assert.equal(protectedOrder.tracks[1].startTime, 5);
assert.ok(protectedOrder.issues.some(issue => issue.includes("对白先后")));
const shorter = structuredClone(scene.shots);
shorter[1].duration = 1;
assert.ok(applyDirectorAudioPlan(shorter, baseTracks).issues.some(issue => issue.includes("声音事件")));
const voice = renderProductionCreativeContext(project, { ...scope, shot: scene.shots[1], dialogueLineIndex: directorDialogueIndex(scene.shots[1], audio.tracks[1]) }, "performance");
assert.ok(voice.includes("平静回应"));
assert.ok(!voice.includes("轻声提醒"));
assert.ok(!voice.includes("双人同框"));
scene.audioTracks = audio.tracks.map((track, i) => ({ ...track, url: i < 2 ? `/media/voice-${i}.wav` : "" }));
const exported = buildEpisodeAudioExportItems([scene], id => id === "ambient" ? "/media/ambient.wav" : undefined);
assert.equal(exported[1].startTime, 4);
assert.equal(exported[2].duration, 10);

const initialHash = directorBindingHash(project, { episode, scene });
project.creativeDirection!.director!.notes = "新选择要求移动摄影机";
assert.notEqual(directorBindingHash(project, { episode, scene }), initialHash);
assert.equal(directorPlanStatus(project, { episode, scene }), "director_changed");
const oldExecution = renderProductionCreativeContext(project, scope, "video");
assert.ok(oldExecution.includes("运镜：固定"));
assert.ok(!oldExecution.includes("新选择要求移动摄影机"));
assert.equal(creativeExecutionManifest(project, scope, "video")?.directorPlanStatus, "director_changed");
delete project.creativeDirection!.director!.notes;
project.characters[2].visualIdentity = "无关角色换外观";
assert.equal(directorPlanStatus(project, { episode, scene }), "current");
project.characters[0].visualIdentity = "黑衬衣";
assert.equal(directorPlanStatus(project, { episode, scene }), "source_changed");
project.characters[0].visualIdentity = "短发，白衬衣";
nextScene.script += "阿林跟上。";
assert.equal(directorPlanStatus(project, { episode, scene }), "source_changed");
nextScene.script = "阿青离开房间。";
scene.scriptBlocks = [{ id: "block-1", type: "action", content: "阿青离开房间。" }] as Scene["scriptBlocks"];
assert.equal(directorPlanStatus(project, { episode, scene }), "source_changed");
delete scene.scriptBlocks;
nextScene.manualStoryboard = { schemaVersion: "manual-storyboard.v1", directorPlan: { ...normalized.plan!, intent: "观察离开时两人的距离" }, updatedAt: 1 };
assert.equal(directorPlanStatus(project, { episode, scene }), "source_changed");
delete nextScene.manualStoryboard;
const before = buildManualShotPlanHash(scene.shots);
scene.shots[1].directing!.dialogue[0].instruction = "稍作停顿";
assert.notEqual(buildManualShotPlanHash(scene.shots), before);

assert.equal(assetDesignContext(project, project.characters[0]).directorReference, undefined); // Camera/cutting prose cannot leak into base appearance.
const asset = buildProductionAssetImageVisualStyleProjection({ project, asset: { assetId: "qing", assetName: "阿青", assetType: "character" } });
assert.ok(!asset.instruction.includes(method)); // Design consumes methods; reference images consume adopted appearance.
const invalid = structuredClone(raw);
invalid[0].directorPlan!.applications[0].shotNumbers = [99];
invalid[1].directing!.dialogue[0].startSeconds = -99;
const invalidResult = normalizeDirectorPlan({ project, episode, scene, rawShots: invalid, shots });
assert.ok(invalidResult.issues.some(issue => issue.includes("有效镜头")));
assert.ok(invalidResult.issues.some(issue => issue.includes("超出本场")));
assert.equal(invalidResult.shots[1].directing!.dialogue[0].startSeconds, undefined);
const legacy = normalizeDirectorPlan({ project, episode, scene, rawShots: [{}, {}], shots });
assert.equal(legacy.plan, undefined);
assert.equal(legacy.shots.length, 2);
assert.ok(legacy.issues[0].includes("仍可采用"));
const off = { ...project, creativeDirection: { director: { mode: "off" as const } } };
assert.equal(normalizeDirectorPlan({ project: off, episode, scene, rawShots: raw, shots }).plan, undefined);
const localScene = structuredClone(scene);
localScene.shots![0].creativeDirection = { director: { mode: "replace", skill } };
const localRaw = structuredClone(raw);
localRaw[0].sourceShotId = "shot-a";
const localDirection = normalizeDirectorPlan({ project: off, episode, scene: localScene, rawShots: localRaw, shots: shots.map(shot => ({ ...shot, id: "new-" + shot.id })) });
assert.equal(localDirection.shots[0].creativeDirection?.director?.skill?.id, skill.id);
assert.equal(localDirection.shots[1].creativeDirection, undefined);
assert.ok(localDirection.plan);
const repairedRaw = structuredClone(localRaw);
delete repairedRaw[0].sourceShotId;
repairedRaw[0].directing = localDirection.shots[0].directing;
const repairedDirection = normalizeDirectorPlan({ project: off, episode, scene: localScene, rawShots: repairedRaw, shots: shots.map(shot => ({ ...shot, id: "repair-" + shot.id })) });
assert.equal(repairedDirection.shots[0].creativeDirection?.director?.skill?.id, skill.id);
localScene.shots = localDirection.shots;
localScene.manualStoryboard!.directorPlan = localDirection.plan;
assert.equal(directorPlanStatus(off, { episode, scene: localScene }), "current");
localScene.shots[0].creativeDirection!.director!.notes = "本镜改用手持";
assert.equal(directorPlanStatus(off, { episode, scene: localScene }), "director_changed");
const prompt = buildCreativeSkillDraftPrompt({ kind: "director", content: "", references: [], analysisNotes: "分析样本：双人同框，听者回应后切镜。" });
assert.ok(prompt.includes("作者提供的参考分析"));
assert.equal(upgradeDirectorPlanTemplate(upgradeDirectorPlanTemplate("作者自定义模板")), "作者自定义模板\n" + directorPlanContract);
console.log("director-plan-self-check: source-bound adoption, per-stage compiled requests, line performance, actual audio/export positions, changed settings, legacy compatibility and invalid output checks passed");
