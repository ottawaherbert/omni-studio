import assert from "node:assert/strict";
import fs from "node:fs";
import { buildGovernedBgmTrackUpdate, type BgmGenerationResult } from "../src/services/production/manualStudioAudio";

const hookSource = fs.readFileSync(new URL("../src/hooks/useManualStudioAI.ts", import.meta.url), "utf8");
const prepareSource = hookSource.slice(hookSource.indexOf("const prepare ="), hookSource.indexOf("const execute ="));
assert.equal(prepareSource.includes("generateAIImage("), false, "Preparing an image must not call the model before Prompt confirmation");
assert.equal(prepareSource.includes("generateAIVideo("), false, "Preparing a video must not call the model before Prompt confirmation");
assert.ok(prepareSource.includes("setPromptRequest"));
assert.ok(hookSource.includes("selectedSkillIds: metadata?.selectedSkillIds"));
assert.ok(hookSource.includes("promptHash: manualStoryboardHash(finalPrompt)"));
assert.ok(hookSource.includes("authorPrompt: finalPrompt"));
assert.ok(hookSource.includes("providerPromptAudit?.finalProviderPrompt || finalPrompt"));
assert.ok(hookSource.includes("providerPromptHash: manualStoryboardHash"));
assert.ok(hookSource.includes("motionContract: videoMotionContract"));
assert.ok(hookSource.includes("onProviderPromptPrepared"));
assert.ok(hookSource.includes("referenceImageUrls"));
assert.ok(hookSource.includes('entry.bindingId.startsWith("board-")'), "Take audit must derive asset identities from the actual submitted manifest");
assert.ok(hookSource.includes('entry.bindingId.startsWith("board-")'), "Take audit must record the exact asset boards that were actually submitted by the selected mode");
assert.ok(hookSource.includes("startFrameUrl: startingImageUrl") && hookSource.includes("startFrameTakeId: videoPreparation?.startFrameTakeId"), "the exact selected first-frame binding must survive prompt confirmation");
assert.ok(hookSource.includes("request.startFrameUrl ||"), "execution must use the prepared first frame instead of recomputing it from a later active Take");
assert.ok(hookSource.includes("endFrameUrl"));
assert.ok(hookSource.includes("generationAudit: audit"));
assert.ok(hookSource.includes("appendShotTakeCandidate(latestShot, take)"));
assert.equal(hookSource.includes("slice(-12)"), false, "pending Studio candidates must not be silently dropped by a fixed history cap");
assert.ok(hookSource.includes("targetKind: request.target.kind"));
assert.ok(hookSource.includes("activeTakeMatchesTarget"));
assert.equal(hookSource.includes("currentProject.assets.filter"), false, "Manual Studio must not pull arbitrary project-wide assets");
assert.equal((hookSource.match(/generateAIVideo\(/g) || []).length, 1, "One confirmed Studio action must submit at most one paid video task");
assert.equal(hookSource.includes("planProviderVideoSegments"), false, "Studio must never split one long shot into hidden paid provider tasks");
assert.ok(hookSource.includes("已阻止自动重复付费生成"), "Overlong shots must be blocked with an explicit split-shot explanation");
assert.ok(hookSource.includes("generateVideoFromIntent"), "Studio must submit governed H3/KIE generation through the shared video intent entry");
assert.ok(hookSource.includes("queryVideoGenerationTask"), "Studio must recover and query the original persisted H3 task after refresh");
assert.equal(
  hookSource.includes("activeTakeId === pending.takeId ? { activeTakeId: undefined }"),
  false,
  "Refreshing a candidate task must not revoke an existing author-selected Take",
);
assert.ok(hookSource.includes("needsComfyUIArchiveRefresh"), "Studio must refresh succeeded legacy ComfyUI proxy URLs until they are archived into project media");
assert.ok(hookSource.includes("videoIdempotencyKey"), "Studio must persist a stable duplicate-submission key");
assert.ok(hookSource.includes("audioProvenance"), "Studio takes must record where their sound came from");
assert.ok(hookSource.includes("rewriteTakeAudio"), "Studio must expose explicit native-audio strip and replacement actions");
const takeReviewSource = fs.readFileSync(new URL("../src/services/production/shotTakeReview.ts", import.meta.url), "utf8");
assert.ok(hookSource.includes("reviseShotTakeAudio(latestShot, takeId") && takeReviewSource.includes("originalVideoUrl: original.videoUrl") && takeReviewSource.includes("appendShotTakeCandidate(shot, next)"), "Studio audio edits must append a separate version and preserve the original take");
assert.ok(hookSource.includes("activeContextRef") && hookSource.includes("contextEpoch"), "Studio async work must bind to a project/episode/scene epoch");
assert.ok(hookSource.includes("awaitPendingSceneWrites"), "Studio must drain queued scene writes before rebasing async results");
assert.ok(
  (hookSource.match(/expectedProjectId: (?:pollingContext|requestContext)\.projectId/g) || []).length === (hookSource.match(/\.updateScene\(/g) || []).length
    && (hookSource.match(/expectedEpisodeId: (?:pollingContext|requestContext)\.episodeId/g) || []).length === (hookSource.match(/\.updateScene\(/g) || []).length,
  "every queued Manual Studio scene write must carry its captured project and episode ids",
);
const importMediaSource = hookSource.slice(hookSource.indexOf("const importMedia ="), hookSource.indexOf("const rewriteTakeAudio ="));
assert.match(importMediaSource, /activeImportRequestIdRef/);
assert.match(importMediaSource, /await awaitPendingSceneWrites\(requestContext\)[\s\S]*latestScene[\s\S]*appendShotTakeCandidate\(latestShot, take\)/);
assert.doesNotMatch(importMediaSource, /updateScene\(scene\.id/);
const rewriteAudioSource = hookSource.slice(hookSource.indexOf("const rewriteTakeAudio ="), hookSource.indexOf("return {", hookSource.indexOf("const rewriteTakeAudio =")));
assert.match(rewriteAudioSource, /activeAudioRewriteRequestIdRef/);
assert.ok((rewriteAudioSource.match(/isRewriteRequestCurrent\(\)/g) || []).length >= 6, "audio rewrite must re-check its request after every async boundary");
assert.match(rewriteAudioSource, /latestTake\.videoUrl !== sourceVideoUrl/);
assert.match(rewriteAudioSource, /await awaitPendingSceneWrites\(requestContext\)[\s\S]*latestTake = latestShot\?\.takes/);
assert.doesNotMatch(rewriteAudioSource, /updateScene\(scene\.id/);

const studioSource = fs.readFileSync(new URL("../src/pages/Studio.tsx", import.meta.url), "utf8");
assert.ok(studioSource.includes("StudioGenerationTargetPicker"));
assert.ok(studioSource.includes("StudioReferenceControlPanel"));
assert.ok(studioSource.includes("selectedManualReferenceBoardItemIds"));
assert.ok(studioSource.includes("generationWayId: selectedVideoAdapter?.id"), "the primary Studio mode selector must initialize the confirmation request");
assert.ok(studioSource.includes("startFrameUrl: selectedStartFrameUrl") && studioSource.includes("endFrameUrl: selectedEndFrameUrl"));
assert.ok(studioSource.includes("includeStoryboardReference") && studioSource.includes("selectedReferenceImageTakeIds") && studioSource.includes("selectedReferenceVideoTakeIds"));
assert.ok(studioSource.includes("selectedDialogueTrackIds") && studioSource.includes("selectedVoiceReferenceIds"), "Studio must preserve exact author-selected audio references instead of auto-expanding them");
assert.ok(studioSource.includes("takeShot={manualStudioTakeOwnerShot}"));
assert.ok(studioSource.includes("onPreviewTake={setPreviewTakeId}"));
assert.ok(studioSource.includes("onAdoptTake={handleAdoptTake}"));
assert.ok(studioSource.includes("isShotTakeReadyForAdoption"));
assert.ok(studioSource.includes("buildManualVideoStoryboardReadModel"));
assert.ok(
  studioSource.includes('manualVideoStoryboardReadModel?.workflow?.unitSchema === "storyboard_unit.v1"'),
  "Studio must resolve the current persisted storyboard unit from the read model instead of a legacy scene-wide prompt status",
);
assert.ok(
  studioSource.includes("manualStudioTargetShot && !manualStudioVideoUnitIssue")
    && studioSource.includes("manualVideoStoryboardReadModel?.studioSourceHash"),
  "Manual Studio requires a real target, not QA approval; source identity remains auditable",
);
assert.ok(
  studioSource.includes("requiredDepartments: manualFilmTeamRequiredDepartmentsForScene(activeScene)"),
  "Studio must evaluate preparation with the same scene-specific department scope used by Preparation and Storyboard",
);
assert.equal(
  studioSource.includes("多宫格中的每个 Shot 都必须先完成视频故事板 QA"),
  false,
  "Studio must not retain the removed legacy multi-grid workflow or its QA gate",
);
assert.ok(studioSource.includes("manualStudioAI.execute"));
assert.ok(studioSource.includes("videoGeneration={manualStudioAI.promptRequest.videoGeneration}"));
assert.ok(studioSource.includes("hasVideoCandidate={isDirectorProductionRoute ? manualVideoCandidateExists : false}"));
assert.ok(
  studioSource.includes("audioEl.muted = isMuted || Boolean(track.muted)")
    && studioSource.includes("track.volume ?? 1")
    && !studioSource.includes("playingShotHasEmbeddedAudio"),
  "Timeline sound must follow author-controlled mute and volume, not be silently suppressed by video provenance",
);

const controlsSource = fs.readFileSync(new URL("../src/components/StudioShotControls.tsx", import.meta.url), "utf8");
assert.ok(controlsSource.includes("governedProductionMode"));
assert.ok(controlsSource.includes("!governedProductionMode && <button"));
assert.ok(controlsSource.includes("promptReadOnly"));
assert.ok(controlsSource.includes("generationGate?.reason"));
assert.ok(controlsSource.includes("再生成一个候选视频"));
assert.ok(controlsSource.includes("本次 Take 的工作草稿") && controlsSource.includes("恢复上游版本"), "Studio prompt edits must remain Take-local and resettable");
assert.ok(controlsSource.includes("governedProductionMode || Boolean(selectedShot.imageUrl)"), "H3 reference generation must not be blocked by the legacy first-frame button gate");

const referenceControlsSource = fs.readFileSync(new URL("../src/components/StudioReferenceControlPanel.tsx", import.meta.url), "utf8");
for (const contract of ["onToggleStoryboardReference", "onToggleReferenceImageTake", "onToggleReferenceVideoTake", "onToggleDialogueTrack", "onToggleVoiceReference"]) {
  assert.ok(referenceControlsSource.includes(contract), `Studio reference controls must expose ${contract}`);
}

const promptModalSource = fs.readFileSync(new URL("../src/components/PromptEditorModal.tsx", import.meta.url), "utf8");
assert.ok(promptModalSource.includes("引用素材"));
assert.ok(promptModalSource.includes("镜头时间"));
assert.ok(promptModalSource.includes("模型提示词"));
assert.ok(promptModalSource.includes("modelReferenceLabels"));
assert.ok(promptModalSource.includes("人物和素材标签已与引用素材不一致"));
assert.ok(promptModalSource.includes("模型专用提示词将按新选择重新整理；通用创作提示词保持不变。"));

const promptSource = fs.readFileSync(new URL("../src/config/prompts/visuals.ts", import.meta.url), "utf8");
const imageGenerationTemplate = promptSource
  .match(/'generateImage':\s*\{[\s\S]*?\n\s*\},\n\s*'generateVideo'/)?.[0] || "";
const videoGenerationTemplate = promptSource
  .match(/'generateVideo':\s*\{[\s\S]*?\n\s*\},\n\s*'generateSpecificPrompt'/)?.[0] || "";
assert.match(imageGenerationTemplate, /\{\{imagePrompt\}\}/);
assert.doesNotMatch(imageGenerationTemplate, /\{\{(?:selectedContext|skills|userIntent)\}\}/);
assert.match(videoGenerationTemplate, /\{\{videoPrompt\}\}/);
assert.match(videoGenerationTemplate, /\{\{userIntent\}\}/);
assert.doesNotMatch(videoGenerationTemplate, /\{\{(?:selectedContext|skills)\}\}/);
assert.ok(
  studioSource.includes('imageReferences={manualStudioAI.promptRequest.action === "image"')
    && studioSource.includes("manualStudioAI.promptRequest.imageReferences.map((reference) => reference.id)")
    && studioSource.includes("imageVisualStyleProjection={manualStudioAI.promptRequest.imageVisualStyleProjection}"),
  "Studio image confirmation must pass selected references and the visual-style projection as structured request data",
);

const previewSource = fs.readFileSync(new URL("../src/components/StudioPreview.tsx", import.meta.url), "utf8");
assert.ok(previewSource.includes("takeShot?.takes?.length"));
assert.ok(previewSource.includes("onPreviewTake?.(take.id)"));
assert.ok(previewSource.includes("onAdoptTake?.(take.id)"));
assert.ok(previewSource.includes("候选尚未生成完成，不能采用"));
assert.ok(previewSource.includes("take.generationAudit.modelId"));
assert.ok(previewSource.includes("移除原声"));
assert.ok(previewSource.includes("替换声音"));

const legacyStudioHookSource = fs.readFileSync(new URL("../src/hooks/useStudioAI.ts", import.meta.url), "utf8");
assert.ok(legacyStudioHookSource.includes("generationContext?.governed"));
assert.ok(legacyStudioHookSource.includes("updateScene(request.sceneId, result.sceneUpdates, request.episodeId)"));
assert.ok(legacyStudioHookSource.includes("provider: audioMedia.source === 'upload' ? 'manual_external' : 'api'"));
assert.ok(legacyStudioHookSource.includes("textHash: manualStoryboardHash(finalText)"));
assert.ok(legacyStudioHookSource.includes("applyStudioVoiceResult({"));
assert.ok(legacyStudioHookSource.includes("result.exceedsShot || result.overlapsNextLine"));

const ttsModalSource = fs.readFileSync(new URL("../src/components/TTSConfigModal.tsx", import.meta.url), "utf8");
assert.match(ttsModalSource, /模型：[\s\S]*?modelId\s*\|\|\s*'系统默认'/, "TTS confirmation must disclose the selected model or the explicit system default");
assert.ok(!ttsModalSource.includes("成本"), "TTS confirmation must not display an invented cost estimate");
assert.match(ttsModalSource, /readOnly=\{readOnly\s*\|\|\s*busy\}/, "TTS dialogue must remain read-only for a governed shot and while an upload is pending");

const audioControlsSource = fs.readFileSync(new URL("../src/components/StudioAudioControls.tsx", import.meta.url), "utf8");
assert.ok(audioControlsSource.includes("bgmGovernedContext"));
assert.ok(audioControlsSource.includes("buildGovernedBgmTrackUpdate"));

const studioAudioServiceSource = fs.readFileSync(new URL("../src/services/production/manualStudioAudio.ts", import.meta.url), "utf8");
assert.ok(studioAudioServiceSource.includes('action: "generate_bgm"'));
assert.ok(studioAudioServiceSource.includes("createAIGeneratedMediaReference"));
assert.ok(studioAudioServiceSource.includes("latestContext.sourceHash !== sourceContext.sourceHash"));
assert.ok(studioAudioServiceSource.includes("generationAudit"));
const bgmResult: BgmGenerationResult = {
  audioUrl: "data:audio/wav;base64,AAAA",
  finalPrompt: "克制的弦乐",
  promptHash: "prompt-hash",
  modelId: "lyria-3-clip-preview",
  provider: "gemini",
  selectedSkillIds: ["skill-1"],
  selectedSkillTitles: ["克制配乐"],
  governedContext: {
    sourceHash: "source-hash",
    trackId: "track-1",
    shotId: "shot-1",
    contextSummary: "场景 / Shot / BGM",
    generationAllowed: true,
  },
  createdAt: 1,
};
const acceptedBgmUpdate = buildGovernedBgmTrackUpdate(bgmResult, bgmResult.governedContext);
assert.equal(acceptedBgmUpdate?.generationAudit?.action, "generate_bgm");
assert.equal(acceptedBgmUpdate?.audioMedia?.source, "ai_generation");
assert.equal(buildGovernedBgmTrackUpdate(bgmResult, { ...bgmResult.governedContext!, sourceHash: "changed" }), null);

const bgmModalSource = fs.readFileSync(new URL("../src/components/BgmGeneratorModal.tsx", import.meta.url), "utf8");
assert.ok(bgmModalSource.includes("finalPrompt"));
assert.ok(bgmModalSource.includes("selectedSkillIds"));
assert.ok(bgmModalSource.includes("governedContext.generationAllowed"));
assert.ok(bgmModalSource.includes("onGenerated?.(result)"));
assert.equal((bgmModalSource.match(/generateAIBgm\(/g) || []).length, 1, "BGM model call must only exist in the confirmed generate handler");

const bgmGovernanceSource = fs.readFileSync(new URL("../src/components/BgmPromptGovernanceFields.tsx", import.meta.url), "utf8");
for (const disclosure of ["执行模型", "镜头 / 音轨上下文", "本次实际提交提示词", "通用 Skill 注入"]) {
  assert.ok(bgmGovernanceSource.includes(disclosure), `BGM popup must disclose ${disclosure}`);
}

const aiSource = fs.readFileSync(new URL("../src/services/ai.ts", import.meta.url), "utf8");
assert.ok(aiSource.includes("endImageUrl?: string"));
assert.ok(aiSource.includes("lastFrame"));
assert.ok(aiSource.includes("veo-3\\.1"), "the existing Gemini/Veo flow remains available without a new adapter");

const referencePanelSource = fs.readFileSync(new URL("../src/components/StudioReferenceControlPanel.tsx", import.meta.url), "utf8");
assert.ok(referencePanelSource.includes("参考素材"));
assert.equal(referencePanelSource.includes("已自动选择"), false, "Studio must not silently choose a reference package for the author");
assert.ok(referencePanelSource.includes("onToggleBoardItem"));
assert.ok(referencePanelSource.includes("本场状态"));
assert.ok(referencePanelSource.includes("supportsEndFrame"));
assert.ok(referencePanelSource.includes("只提交这里明确选择且当前方式允许的素材"));

console.log("Manual Studio self-check passed.");
