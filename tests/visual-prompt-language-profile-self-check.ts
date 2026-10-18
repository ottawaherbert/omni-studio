import assert from "node:assert";
import fs from "node:fs";
import {
  compileVideoProviderPrompt,
  formatVisualPromptForModel,
  mapVideoMotionContractToProvider,
  resolveVisualPromptLanguageProfile,
  resolveVideoProviderType,
} from "../src/services/production/visualPromptLanguageProfile";

/**
 * Self check script for Phase 5: Production Drafts, Language Profiles, and Motion Contracts.
 * Tests CORE-AUDIT-PROD-TEST-001 ~ TEST-005 requirements.
 */

function runSelfCheck() {
  console.log("Running visual-prompt-language-profile self check (Phase 5 tests)...");

  // TEST-004: Language Profile resolution
  const geminiProfile = resolveVisualPromptLanguageProfile({ modelId: "veo-3.1" });
  assert.strictEqual(geminiProfile.policy, "en");

  const klingProfile = resolveVisualPromptLanguageProfile({ modelId: "kling-v1.5" });
  assert.strictEqual(klingProfile.policy, "zh");

  // TEST-004: Author prompt vs final provider prompt audit
  const formatted = formatVisualPromptForModel({
    authorPrompt: "一个穿西装的男主角站在雨中",
    profile: geminiProfile,
    technicalDeltas: ["wide angle", "cinematic lighting"],
  });
  console.log("[Formatted Prompts]:", formatted);
  assert.strictEqual(formatted.authorPrompt, "一个穿西装的男主角站在雨中");
  assert.strictEqual(formatted.finalProviderPrompt.includes("wide angle"), true);

  // Motion Contract Mapping
  const motionParams = mapVideoMotionContractToProvider({
    contract: { motionStrength: 8, cameraPan: 2, cameraZoom: -1 },
    providerType: "kling",
  });
  console.log("[Kling Motion Params]:", motionParams);
  assert.strictEqual(motionParams.motion_magnitude, 8);
  assert.strictEqual((motionParams.camera_control as { pan: number }).pan, 2);

  const kieProfile = resolveVisualPromptLanguageProfile({
    providerId: "kie",
    modelId: "grok-imagine-video-1-5-preview",
  });
  const kieExecution = compileVideoProviderPrompt({
    authorPrompt: "林照推开控制室铁门。",
    profile: kieProfile,
    providerType: resolveVideoProviderType("kie", "grok-imagine-video-1-5-preview"),
    motionContract: {
      cameraMotion: "缓慢向前推进",
      subjectMotion: "铁门由关闭到完全打开",
      durationSeconds: 6,
      loop: false,
    },
  });
  assert.strictEqual(kieExecution.authorPrompt, "林照推开控制室铁门。");
  assert.match(kieExecution.finalProviderPrompt, /运动合同/);
  assert.match(kieExecution.finalProviderPrompt, /缓慢向前推进/);
  assert.deepStrictEqual(kieExecution.nativeOptions, {}, "Grok adapter must not receive undocumented motion parameters");

  const geminiExecution = compileVideoProviderPrompt({
    authorPrompt: "A locked-off close-up.",
    profile: geminiProfile,
    providerType: resolveVideoProviderType("gemini", "veo-3.1"),
    motionContract: { subjectMotion: "eyes shift toward the door", durationSeconds: 5 },
  });
  assert.match(geminiExecution.finalProviderPrompt, /Motion contract/);
  assert.deepStrictEqual(geminiExecution.nativeOptions, {}, "Gemini adapter must not receive undocumented motion parameters");

  const aiServiceSource = fs.readFileSync(new URL("../src/services/ai.ts", import.meta.url), "utf8");
  assert.match(aiServiceSource, /compileVideoProviderPrompt\(\{/);
  assert.match(aiServiceSource, /finalConfirmedPrompt: providerPrompt/);
  assert.match(aiServiceSource, /prompt: request\.prompt/);
  assert.match(aiServiceSource, /onProviderPromptPrepared\?\.\(providerPromptAudit\)/);

  console.log("Visual language, provider prompt audit, and current adapter motion compilation self-check passed.");
}

runSelfCheck();
