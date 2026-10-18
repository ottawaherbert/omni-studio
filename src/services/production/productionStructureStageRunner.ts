import { Type } from "@google/genai";
import type { Episode } from "../../types/project";
import type {
  ProductionStageExecutionResult,
  ProductionStageRun,
} from "../../types/production";
import {
  buildStructureInstruction,
  getFormatProductionProfile,
  resolveStructureTargetCount,
} from "../../config/formatProductionProfiles";
import { compactJson, renderPromptTemplate } from "./promptUtils";
import { loadProductionPromptTemplate } from "./templateLoader";
import { validateStructureRules } from "./ruleQa";
import { addEpisode, getProject } from "./runnerRepositoryAccess";
import { makeArtifact, makeQA } from "./runnerArtifacts";
import {
  aiTrace,
  generateStageAIContent,
} from "./productionPromptRuntime";
import {
  parseResult,
  projectContext,
  revisionGuidance,
} from "./productionPromptContext";

const productionStructureTemplate = {
  id: "production.structure",
  name: "自动制片：结构与分集规划",
  template: `你是影视结构总编剧。请基于项目圣经、类型体量和当前进度，生成可继续拆场景的结构方案。

{{projectContext}}
{{formatInstruction}}
{{revisionGuidance}}

目标段落/分集数量: {{targetCount}}
当前已有结构:
{{existingProgress}}

请严格返回 JSON：
{
  "options": [{
    "optionId": "方案编号",
    "optionDescription": "方案说明",
    "episodes": [{
      "title": "段落或分集标题",
      "inspiration": "详细梗概、关键节拍、人物推进、钩子或段落功能",
      "targetDuration": 10
    }]
  }]
}`,
};

export const executeStructureStage = async (
  stage: ProductionStageRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const formatProfile = getFormatProductionProfile(project);
  const targetCount = resolveStructureTargetCount(project, formatProfile);
  const loadedTemplate = await loadProductionPromptTemplate("production.structure", productionStructureTemplate);
  const prompt = renderPromptTemplate(loadedTemplate.template, {
    projectContext: projectContext(project, stage),
    formatInstruction: buildStructureInstruction(formatProfile, targetCount, revisionGuidance(stage)),
    revisionGuidance: revisionGuidance(stage),
    targetCount,
    existingProgress: project.episodes?.length ? compactJson(project.episodes) : "新项目，尚无分集或段落。",
  });

  const response = await generateStageAIContent(stage, {
    prompt,
    requireJson: true,
    schema: {
      type: Type.OBJECT,
      properties: {
        options: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              optionId: { type: Type.STRING },
              optionDescription: { type: Type.STRING },
              episodes: { type: Type.ARRAY, items: { type: Type.OBJECT } },
            },
          },
        },
      },
      required: ["options"],
    },
  });
  const data = parseResult<any>(response, { options: [] });
  const selected = data.options?.[0];
  const episodes: Episode[] = (selected?.episodes || []).map((episode: any, index: number) => ({
    id: `episode-${Date.now()}-${index}-${crypto.randomUUID()}`,
    title: episode.title || `${project.type === "movie" ? "段落" : "第"} ${index + 1}`,
    inspiration: episode.inspiration || episode.description || "",
    targetDuration: episode.targetDuration,
    scenes: [],
  }));

  if (episodes.length === 0) {
    throw new Error("结构阶段没有生成有效 episodes。");
  }

  for (const episode of episodes) {
    await addEpisode(episode);
  }

  return {
    summary: `已生成并写入 ${episodes.length} 个${formatProfile.unitName}。`,
    artifacts: [
      makeArtifact("episode", "project.episodes", "结构/分集规划", episodes.map((episode) => episode.id)),
    ],
    qaReports: [makeQA("structure.qa", validateStructureRules(project, episodes))],
    ...aiTrace(stage, prompt, response, loadedTemplate.trace),
    outputSnapshot: episodes,
  };
};
