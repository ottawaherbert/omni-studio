import assert from "node:assert/strict";
import fs from "node:fs";

import { resolveVisualStyleInheritancePresentation } from "../src/components/production/VisualStyleInheritanceBadge";
import {
  collectVisualStyleSourceChangedFields,
  resolveVisualStyleSourceReviewForUpdate,
} from "../src/store/visualStyleSourceReview";
import type { Project, VisualStyleLock } from "../src/types/project";

type VisualSourceProject = Pick<Project, "creativeVision" | "globalGenerationParams" | "originalStyleReference">;

const existing: VisualSourceProject = {
  creativeVision: {
    genre: ["悬疑"],
    visualStyle: "低饱和自然主义",
    narrativeStyle: "限制视角",
    referenceWorks: "现有视觉参考",
    want: "查清真相",
    need: "学会信任",
    globalLookTags: "35mm 颗粒",
    globalLook: {
      baseTexture: ["35mm 颗粒"],
      colorGrading: ["冷青阴影"],
      conditionalEffects: [{ tag: "轻微炫光", condition: "画面内有强光源" }],
    },
  },
  globalGenerationParams: {
    qualityPrompt: "清晰材质",
    negativePrompt: "禁止水印",
    globalAppendedPrompt: "保持连续性",
  },
  originalStyleReference: { mode: "region", text: "江南潮湿街巷" },
};

const narrativeOnly = collectVisualStyleSourceChangedFields({
  existing,
  updates: {
    creativeVision: {
      ...existing.creativeVision!,
      narrativeStyle: "多线并行",
      want: "离开此地",
      need: "承担责任",
      stakes: "失去同盟",
      themeQuestion: "信任是否值得",
    },
  },
});
assert.deepEqual(narrativeOnly, [], "narrative-only creativeVision edits must not mark the visual lock for review");

const noOp = collectVisualStyleSourceChangedFields({
  existing,
  updates: {
    creativeVision: {
      ...existing.creativeVision!,
      globalLook: {
        conditionalEffects: [{ condition: "画面内有强光源", tag: "轻微炫光" }],
        colorGrading: ["冷青阴影"],
        baseTexture: ["35mm 颗粒"],
      },
    },
    globalGenerationParams: { ...existing.globalGenerationParams },
    originalStyleReference: { ...existing.originalStyleReference! },
  },
});
assert.deepEqual(noOp, [], "equivalent visual source values must not create a review recommendation");

const visualChange = collectVisualStyleSourceChangedFields({
  existing,
  updates: {
    creativeVision: { ...existing.creativeVision!, visualStyle: "高饱和图形动画" },
    globalGenerationParams: { ...existing.globalGenerationParams, negativePrompt: "禁止文字与水印" },
    originalStyleReference: { mode: "region", text: "北方冬季工业城" },
  },
});
assert.deepEqual(visualChange, [
  "creativeVision.visualStyle",
  "globalGenerationParams.negativePrompt",
  "originalStyleReference",
]);

const currentReview = { status: "current" as const, changedFields: [], detectedAt: 1, basedOnRevision: 2 };
assert.deepEqual(resolveVisualStyleSourceReviewForUpdate({
  existing: { revision: 2, sourceReview: currentReview },
  upstreamChangedFields: narrativeOnly,
  detectedAt: 2,
}), currentReview);
assert.equal(resolveVisualStyleSourceReviewForUpdate({
  existing: { revision: 2, sourceReview: currentReview },
  upstreamChangedFields: visualChange,
  detectedAt: 3,
})?.status, "review_recommended");

const rejectedPresentation = resolveVisualStyleInheritancePresentation({
  visualStyleLock: {
    humanApprovalState: "rejected",
    visualImplementation: {
      productionMode: "2d_animation",
      appearance: {
        realism: "stylized",
        dimensionality: "flat_2d",
        finish: "graphic",
        descriptors: ["REJECTED_STYLE_MUST_NOT_RENDER"],
      },
      techniques: ["rejected technique"],
      specification: {
        kind: "2d_animation",
        animationMethod: "hand_drawn",
        lineSystem: [],
        colorApplication: [],
        depthStrategy: [],
        motionCadence: [],
        compositing: [],
      },
    },
  } as VisualStyleLock,
  fallbackVisualStyle: "fallback style",
});
assert.equal(rejectedPresentation.status, "已拒绝 / 需重设");
assert.equal(rejectedPresentation.mode, "未继承");
assert.doesNotMatch(JSON.stringify(rejectedPresentation), /REJECTED_STYLE_MUST_NOT_RENDER|fallback style/);

const projectSliceSource = fs.readFileSync(new URL("../src/store/slices/projectSlice.ts", import.meta.url), "utf8");
assert.match(projectSliceSource, /collectVisualStyleSourceChangedFields\(\{/);
assert.doesNotMatch(projectSliceSource, /Object\.keys\(normalizedUpdates\.creativeVision/);

console.log("Visual style source-review and rejected-state self-check passed.");
