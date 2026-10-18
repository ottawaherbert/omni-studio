import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const storeSource = read("src/store/useSkillStore.ts");
const clientSource = read("apps/web/src/clients/skillClient.ts");
const routeSource = read("src/server/routes/skillRoutes.ts");
const skillDraftSource = read("src/components/SkillDraftAssistant.tsx");
const genericPromptEditorSource = read("src/components/PromptEditorModal.tsx");
const imagePromptSource = read("src/components/ImagePromptModal.tsx");
const skillForgeSource = read("src/components/SkillForge.tsx");
const skillOverrideSource = read("src/components/SkillOverrideModal.tsx");

const promptBuilderSource = read("src/lib/promptBuilder.ts");
const studioAISource = read("src/hooks/useStudioAI.ts");
const gameEditorHelpersSource = read("src/utils/gameEditorHelpers.ts");
const bibleAISource = read("src/hooks/useBibleAI.ts");

const shotAnalysisSource = read("src/pages/ShotAnalysis.tsx");
const universalSkillTextSource = read("src/utils/universalSkillText.ts");
const promptRegistrySource = read("src/config/prompts/index.ts");
const domainIndexSource = read("packages/domain/src/index.ts");
const skillDtoSource = read("packages/domain/src/skill.ts");
const skillPromptSource = read("packages/domain/src/skillPrompt.ts");
const projectTypeSource = read("src/types/project.ts");
const videoAnalysisTypeSource = read("src/types/videoAnalysis.ts");
const legacyProjectSkillField = ["active", "Skills"].join("");
const legacyProjectSkillFieldHits = execSync(
  `rg -n "\\b${legacyProjectSkillField}\\b" src apps packages tests tools --glob '*.ts' --glob '*.tsx' || true`,
  { encoding: "utf8" },
).trim().split("\n").filter(Boolean);
const legacyProjectSkillFieldFiles = Array.from(new Set(
  legacyProjectSkillFieldHits.map((line) => line.split(":")[0]),
)).sort();
assert.deepEqual(legacyProjectSkillFieldFiles, [
  "src/utils/universalSkillRefs.ts",
], "legacy project Skill field should only be read in migration/normalization boundaries");

assert.ok(storeSource.includes("skillClient"), "useSkillStore should use skillClient");
assert.equal(storeSource.includes("fetch("), false, "useSkillStore should not call fetch directly");
assert.equal(storeSource.includes("/api/skills"), false, "useSkillStore should not hard-code skill API paths");
assert.ok(clientSource.includes("/api/skills"), "skillClient should own skill API paths");
assert.ok(clientSource.includes("/api/skills/ai-draft"), "skillClient should own Skill AI draft API path");
assert.ok(clientSource.includes("draftSkillWithAI"), "skillClient should expose AI draft method");
assert.ok(clientSource.includes("packages/domain/src/skill"), "skillClient should use shared Skill DTOs");
assert.ok(domainIndexSource.includes("./skill"), "domain package should export Skill DTOs");
assert.ok(skillDtoSource.includes("SkillDTO"), "shared domain package should define SkillDTO");
assert.ok(skillDtoSource.includes("SkillAIDraftRequest"), "shared domain package should define Skill AI draft request");
assert.ok(skillPromptSource.includes("buildSkillAIDraftPrompt"), "shared domain package should own Skill AI draft prompt");
assert.ok(routeSource.includes('"/api/skills/ai-draft"'), "skillRoutes should expose Skill AI draft endpoint");
assert.ok(routeSource.includes("generateServerGenericAIJson"), "Skill AI draft should call the real server model provider");
assert.ok(skillDraftSource.includes("buildSkillAIDraftPrompt"), "Skill composer should show the editable AI draft prompt");
assert.ok(skillDraftSource.includes("采用到编辑区"), "AI output should be reviewed before adoption into the shared editor");
assert.ok(genericPromptEditorSource.includes("通用 Skill 注入"), "generic PromptEditorModal should expose universal Skill selection");
assert.ok(genericPromptEditorSource.includes("【作者选择的通用 Skill】"), "generic PromptEditorModal should inject universal Skill source blocks");
assert.ok(genericPromptEditorSource.includes("PromptEditorConfirmMetadata"), "generic PromptEditorModal should expose selected Skill metadata on confirm");
assert.ok(genericPromptEditorSource.includes("selectedSkillTitles"), "generic PromptEditorModal should record selected Skill titles");
assert.ok(genericPromptEditorSource.includes("搜索 Skill 标题或内容"), "generic PromptEditorModal should support Skill search");
assert.ok(genericPromptEditorSource.includes("全部分类"), "generic PromptEditorModal should support Skill category filtering");
assert.ok(genericPromptEditorSource.includes("暂无通用 Skill"), "generic PromptEditorModal should show an empty Skill state");
assert.ok(genericPromptEditorSource.includes("打开 Skill 库创建"), "generic PromptEditorModal should link to Skill Library from empty state");
assert.equal(genericPromptEditorSource.includes("currentProject?.universalSkillRefs?.map"), false, "generic PromptEditorModal must not auto-select project universalSkillRefs");
assert.equal(genericPromptEditorSource.includes("风格与类型指令"), false, "generic PromptEditorModal must not use old structured StyleSkill injection wording");
assert.equal(genericPromptEditorSource.includes("project_creative_styles"), false, "generic PromptEditorModal must not inject old project creative style XML");
assert.equal(skillDtoSource.includes("promptModifiers"), false, "universal SkillDTO must not expose old structured prompt modifiers");
assert.equal(skillDtoSource.includes("formatCompatibility"), false, "universal SkillDTO must not expose old format compatibility");
assert.equal(imagePromptSource.includes("promptModifiers?.imageAppendedTags"), false, "ImagePromptModal must inject universal Skill content, not old image appended tags");
assert.equal(imagePromptSource.includes("极高优先级指令"), false, "ImagePromptModal must not turn Skills into hidden override directives");
assert.equal(skillForgeSource.includes("StyleSkill"), false, "Settings SkillForge must not keep the old StyleSkill editor");
assert.equal(skillForgeSource.includes("generateAIContent"), false, "Settings SkillForge must not keep old structured AI Skill generation");
assert.equal(skillOverrideSource.includes("useVideoAnalysisStore"), false, "Scene Skill override must not mix video-analysis DNA into universal Skills");
assert.equal(skillOverrideSource.includes("Video Analysis DNA"), false, "Scene Skill override must not show legacy video DNA as Skill");
assert.equal(skillOverrideSource.includes("Style Skills"), false, "Scene Skill override UI must not use old Style Skills wording");
assert.equal(skillOverrideSource.includes("formatCompatibility"), false, "Scene Skill override must not display old format compatibility");
assert.equal(skillOverrideSource.includes("referenceStrength"), false, "Scene Skill override must not display old reference strength");
assert.ok(projectTypeSource.includes("export interface UniversalSkillReference"), "Project types should define lightweight universal Skill references");
assert.equal(projectTypeSource.includes("export interface StyleSkill"), false, "Project types must not define the old structured skill model");
assert.ok(videoAnalysisTypeSource.includes("export interface VideoAnalysisSkill"), "Video analysis should use its own reference profile type");
assert.equal(projectTypeSource.includes("overrideSkills?: StyleSkill[]"), false, "Scene.overrideSkills must not use old StyleSkill[]");
assert.ok(projectTypeSource.includes("universalSkillRefs?: UniversalSkillReference[]"), "Project should expose universalSkillRefs for project-level Skill references");
assert.equal(projectTypeSource.includes("universalSkillRefs?: StyleSkill[]"), false, "Project.universalSkillRefs must not use old StyleSkill[]");
assert.equal(projectTypeSource.includes("boundSkillId"), false, "Character model must not keep old boundSkillId");

assert.equal(promptRegistrySource.includes("skillTemplates"), false, "Prompt registry must not expose the old structured Skill generator");
assert.equal(promptBuilderSource.includes("promptModifiers.imageAppendedTags"), false, "promptBuilder must not consume old Skill image tags");
assert.equal(promptBuilderSource.includes("promptModifiers.videoAppendedTags"), false, "promptBuilder must not consume old Skill video tags");
assert.equal(studioAISource.includes("promptModifiers?.imageAppendedTags"), false, "Studio image generation must consume universal Skill text");
assert.equal(studioAISource.includes("promptModifiers?.videoAppendedTags"), false, "Studio video generation must consume universal Skill text");
assert.equal(gameEditorHelpersSource.includes("skill.narrative"), false, "Game editor bible must not split Skill narrative fields");
assert.equal(gameEditorHelpersSource.includes("skill.promptModifiers"), false, "Game editor bible must not split Skill prompt modifiers");
assert.equal(bibleAISource.includes("sourceType === 'video-analysis'"), false, "Bible AI must not treat video-analysis StyleSkill as character Skill");

assert.equal(universalSkillTextSource.includes("record.name"), false, "Universal Skill text helper must not read legacy name");
assert.equal(universalSkillTextSource.includes("record.description"), false, "Universal Skill text helper must not read legacy description");
assert.equal(routeSource.includes("raw.description"), false, "Skill AI draft normalization must not accept legacy description");
assert.equal(routeSource.includes("raw.prompt"), false, "Skill AI draft normalization must not accept legacy prompt");
assert.equal(routeSource.includes("raw.rules"), false, "Skill AI draft normalization must not accept legacy rules");
assert.ok(shotAnalysisSource.includes("PromptEditorModal"), "Shot analysis manual AI actions should confirm prompts through PromptEditorModal");
assert.ok(shotAnalysisSource.includes("shotAnalysisSegment"), "Shot analysis segment extraction should use a prompt confirmation template");
assert.ok(shotAnalysisSource.includes("shotAnalysisMacro"), "Shot analysis macro extraction should use a prompt confirmation template");
assert.ok(promptRegistrySource.includes("shotAnalysisTemplates"), "Prompt registry should include shot analysis confirmation templates");

console.log("Skill client boundary self-check passed.");
