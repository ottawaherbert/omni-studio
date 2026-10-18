import { Type } from "@google/genai";
import type {
  ProductionRun,
  ProductionStageExecutionResult,
  ProductionStageRun,
} from "../../types/production";
import { renderPromptTemplate } from "./promptUtils";
import { loadProductionPromptTemplate } from "./templateLoader";
import { validateConceptRules } from "./ruleQa";
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

const productionConceptTemplate = {
  id: "production.concept",
  name: "自动制片：立项概念",
  template: `你是电影开发制片人与剧作顾问。请基于以下项目输入，补全或强化立项概念。

{{projectContext}}
{{revisionGuidance}}

请严格返回 JSON：
{
  "logline": "一句话故事",
  "coreConflict": "用【外部目标】【内在缺失】【对抗力量】【终极代价】四段描述",
  "creativeVision": {
    "genre": ["类型标签"],
    "visualStyle": "视觉风格",
    "narrativeStyle": "叙事风格",
    "referenceWorks": "参考作品或风格坐标",
    "want": "主角外部目标，必须是可拍摄行动",
    "need": "主角内在缺失或错误信念",
    "stakes": "失败后不可逆代价",
    "oppositionForce": "具体对抗力量",
    "themeQuestion": "作品要反复追问的主题问题",
    "protagonistArc": "主角从什么认知走向什么认知",
    "emotionalReward": "观众最终获得的情感补偿"
  }
}`,
};

export const executeConceptStage = async (
  _run: ProductionRun,
  stage: ProductionStageRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const loadedTemplate = await loadProductionPromptTemplate("production.concept", productionConceptTemplate);
  const prompt = renderPromptTemplate(loadedTemplate.template, {
    projectContext: projectContext(project, stage),
    revisionGuidance: revisionGuidance(stage),
  });

  const response = await generateStageAIContent(stage, {
    prompt,
    requireJson: true,
    schema: {
      type: Type.OBJECT,
      properties: {
        logline: { type: Type.STRING },
        coreConflict: { type: Type.STRING },
        creativeVision: {
          type: Type.OBJECT,
          properties: {
            genre: { type: Type.ARRAY, items: { type: Type.STRING } },
            visualStyle: { type: Type.STRING },
            narrativeStyle: { type: Type.STRING },
            referenceWorks: { type: Type.STRING },
            want: { type: Type.STRING },
            need: { type: Type.STRING },
            stakes: { type: Type.STRING },
            oppositionForce: { type: Type.STRING },
            themeQuestion: { type: Type.STRING },
            protagonistArc: { type: Type.STRING },
            emotionalReward: { type: Type.STRING },
          },
        },
      },
      required: ["logline", "coreConflict", "creativeVision"],
    },
  });
  const data = parseResult<any>(response, {});
  await updateProject({
    logline: data.logline || project.logline,
    coreConflict: data.coreConflict || project.coreConflict,
    creativeVision: {
      ...(project.creativeVision || { genre: [], visualStyle: "", narrativeStyle: "", referenceWorks: "" }),
      ...(data.creativeVision || {}),
    },
  });

  const issues = validateConceptRules({
    ...project,
    logline: data.logline || project.logline,
    coreConflict: data.coreConflict || project.coreConflict,
    creativeVision: {
      ...(project.creativeVision || { genre: [], visualStyle: "", narrativeStyle: "", referenceWorks: "" }),
      ...(data.creativeVision || {}),
    },
  });
  if (!data.logline) issues.push(makeIssue("concept.logline", "AI 未返回 logline。", "blocking"));
  if (!data.coreConflict) issues.push(makeIssue("concept.coreConflict", "AI 未返回核心冲突。", "blocking"));
  return {
    summary: "已生成并写入立项概念、核心冲突与创作视点。",
    artifacts: [
      makeArtifact("concept", "project.logline", "立项概念", [project.id]),
    ],
    qaReports: [makeQA("concept.qa", issues)],
    ...aiTrace(stage, prompt, response, loadedTemplate.trace),
    outputSnapshot: data,
  };
};
