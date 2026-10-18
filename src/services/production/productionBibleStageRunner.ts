import { Type } from "@google/genai";
import type { WorldBuildingRule } from "../../types/project";
import type {
  ProductionRun,
  ProductionStageExecutionResult,
  ProductionStageRun,
} from "../../types/production";
import { getDefaultCharacterCount } from "../../utils/projectUtils";
import { renderPromptTemplate } from "./promptUtils";
import { loadProductionPromptTemplate } from "./templateLoader";
import { validateBibleRules } from "./ruleQa";
import { getProject, updateProject } from "./runnerRepositoryAccess";
import { makeArtifact, makeIssue, makeQA } from "./runnerArtifacts";
import {
  aiTrace,
  generateStageAIContent,
} from "./productionPromptRuntime";
import {
  parseResult,
  projectContext,
  revisionGuidance,
} from "./productionPromptContext";

const productionBibleTemplate = {
  id: "production.bible",
  name: "自动制片：项目圣经规划",
  template: `你是影视项目圣经总设计师。请基于项目概念生成可生产的世界观、角色规划、地点规划和关键道具规划。

{{projectContext}}
{{revisionGuidance}}

数量建议：
- 核心主角 {{leadCount}}
- 主要配角 {{supportingCount}}
- 关键场景 6-10 个
- 关键道具 6-10 个

严格返回 JSON：
{
  "worldBuildingRules": [{"category": "规则类别", "content": "规则内容"}],
  "plannedCharacters": [{"name": "角色名", "roleType": "lead|supporting|extra", "brief": "人物定位"}],
  "plannedLocations": [{"name": "地点名", "brief": "地点功能与视觉特质"}],
  "plannedProps": [{"name": "道具名", "brief": "道具功能与剧情意义"}]
}`,
};

export const executeBibleStage = async (
  _run: ProductionRun,
  stage: ProductionStageRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const counts = getDefaultCharacterCount(project.type, project.durationMinutes);
  const loadedTemplate = await loadProductionPromptTemplate("production.bible", productionBibleTemplate);
  const prompt = renderPromptTemplate(loadedTemplate.template, {
    projectContext: projectContext(project, stage),
    revisionGuidance: revisionGuidance(stage),
    leadCount: counts.leads,
    supportingCount: counts.supporting,
  });

  const response = await generateStageAIContent(stage, {
    prompt,
    requireJson: true,
    schema: {
      type: Type.OBJECT,
      properties: {
        worldBuildingRules: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              content: { type: Type.STRING },
            },
            required: ["category", "content"],
          },
        },
        plannedCharacters: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              roleType: { type: Type.STRING },
              brief: { type: Type.STRING },
            },
            required: ["name", "roleType", "brief"],
          },
        },
        plannedLocations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              brief: { type: Type.STRING },
            },
          },
        },
        plannedProps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              brief: { type: Type.STRING },
            },
          },
        },
      },
      required: ["worldBuildingRules", "plannedCharacters", "plannedLocations", "plannedProps"],
    },
  });
  const data = parseResult<any>(response, {});

  const worldBuildingRules: WorldBuildingRule[] = (data.worldBuildingRules || []).map((rule: any) => ({
    id: `world-rule-${Date.now()}-${crypto.randomUUID()}`,
    category: rule.category || "世界观规则",
    content: rule.content || "",
  }));
  const plannedCharacters = (data.plannedCharacters || []).map((character: any) => ({
    id: `planned-char-${Date.now()}-${crypto.randomUUID()}`,
    name: character.name,
    roleType: ["lead", "supporting", "extra"].includes(character.roleType) ? character.roleType : "supporting",
    brief: character.brief || "",
    isDetailed: false,
  }));
  const plannedLocations = (data.plannedLocations || []).map((location: any) => ({
    id: `planned-location-${Date.now()}-${crypto.randomUUID()}`,
    name: location.name,
    type: "location" as const,
    brief: location.brief || "",
    isDetailed: false,
  }));
  const plannedProps = (data.plannedProps || []).map((prop: any) => ({
    id: `planned-prop-${Date.now()}-${crypto.randomUUID()}`,
    name: prop.name,
    type: "prop" as const,
    brief: prop.brief || "",
    isDetailed: false,
  }));

  await updateProject({
    worldBuildingRules,
    plannedCharacters,
    plannedLocations,
    plannedProps,
  });

  const issues = validateBibleRules({
    ...project,
    worldBuildingRules,
    plannedCharacters,
    plannedLocations,
    plannedProps,
  });
  if (plannedCharacters.length === 0) issues.push(makeIssue("bible.plannedCharacters", "角色规划为空。", "blocking"));
  if (plannedLocations.length === 0) issues.push(makeIssue("bible.plannedLocations", "场景规划为空。", "warning"));
  return {
    summary: `已生成 ${plannedCharacters.length} 个角色规划、${plannedLocations.length} 个场景规划、${plannedProps.length} 个道具规划。`,
    artifacts: [
      makeArtifact("bible", "project.worldBuildingRules", "世界观规则", worldBuildingRules.map((rule) => rule.id)),
      makeArtifact("character", "project.plannedCharacters", "角色规划", plannedCharacters.map((character) => character.id)),
      makeArtifact("location", "project.plannedLocations", "场景规划", plannedLocations.map((asset) => asset.id)),
      makeArtifact("prop", "project.plannedProps", "道具规划", plannedProps.map((asset) => asset.id)),
    ],
    qaReports: [makeQA("bible.qa", issues)],
    ...aiTrace(stage, prompt, response, loadedTemplate.trace),
    outputSnapshot: { worldBuildingRules, plannedCharacters, plannedLocations, plannedProps },
  };
};
