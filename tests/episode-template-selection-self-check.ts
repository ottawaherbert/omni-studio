import assert from "node:assert/strict";
import { FORMAT_ROUTING } from "../src/config/templates";
import { getFormatProductionProfile } from "../src/config/formatProductionProfiles";
import { getManualTemplateFit } from "../src/utils/manualTemplateFit";
import { buildEpisodeTemplateProjectText, selectDefaultEpisodeTemplateIds } from "../src/utils/episodeTemplateSelection";

const profile = getFormatProductionProfile({ type: "short-drama" });
const shortDramaTemplates = FORMAT_ROUTING["short-drama"];

const cultivationSelection = selectDefaultEpisodeTemplateIds({
  project: {
    id: "topic-cultivation",
    title: "凡骨试炼",
    type: "short-drama",
    originalInspiration: "一个凡骨杂役在宗门废丹房唤醒器灵，通过灵根、丹炉、丹方和外门大比逆袭。",
    episodes: [],
  } as any,
  skeletons: shortDramaTemplates.skeletons,
  beats: shortDramaTemplates.beats,
  profile,
});
assert.equal(cultivationSelection.skeletonId, "skel-short-xianxia-cultivation");
assert.equal(cultivationSelection.beatId, profile.defaultBeatId);

const cultivationTemplate = shortDramaTemplates.skeletons.find((template) => template.id === cultivationSelection.skeletonId);
assert.ok(cultivationTemplate);
const fit = getManualTemplateFit({
  template: cultivationTemplate,
  profile,
  kind: "skeleton",
  source: "builtIn",
  projectTopicText: buildEpisodeTemplateProjectText({
    id: "topic-cultivation",
    title: "凡骨试炼",
    type: "short-drama",
    originalInspiration: "一个凡骨杂役在宗门废丹房唤醒器灵，通过灵根、丹炉、丹方和外门大比逆袭。",
    episodes: [],
  } as any),
});
assert.match(fit.recommendation, /模板关键词命中/);
assert.match(fit.recommendation, /凡骨/);

const fallbackSelection = selectDefaultEpisodeTemplateIds({
  project: {
    id: "topic-default",
    title: "都市身份谜局",
    type: "short-drama",
    originalInspiration: "一个普通打工人被家族误解，后续身份曝光。",
    episodes: [],
  } as any,
  skeletons: shortDramaTemplates.skeletons,
  beats: shortDramaTemplates.beats,
  profile,
});
assert.equal(fallbackSelection.skeletonId, profile.defaultSkeletonId);

console.log("episode template selection self-check passed");
