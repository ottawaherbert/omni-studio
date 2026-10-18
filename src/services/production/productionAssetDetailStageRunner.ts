import { Type } from "@google/genai";
import type {
  Asset,
  Character,
} from "../../types/project";
import type {
  ProductionStageExecutionResult,
  ProductionStageRun,
} from "../../types/production";
import { compactJson, renderPromptTemplate } from "./promptUtils";
import { loadProductionPromptTemplate } from "./templateLoader";
import { createAssetDetailQAReports } from "./linearAgents";
import { buildVideoStoryboardAssetBoardPlan } from "./videoStoryboardAssetBoards";
import { getProject, updateProject } from "./runnerRepositoryAccess";
import { makeArtifact } from "./runnerArtifacts";
import {
  aiTrace,
  generateStageAIContent,
} from "./productionPromptRuntime";
import {
  parseResult,
  projectContext,
  revisionGuidance,
} from "./productionPromptContext";

const productionAssetDetailTemplate = {
  id: "production.assetDetail",
  name: "自动制片：资产细化",
  template: `你是电影选角导演、制作设计师和道具师。请把待确认资产规划扩展成可生产档案。

{{projectContext}}
{{revisionGuidance}}

待扩展角色：
{{plannedCharacters}}

待扩展场景：
{{plannedLocations}}

待扩展道具：
{{plannedProps}}

严格返回 JSON：
{
  "characters": [{
    "name": "角色名",
    "visualIdentity": "可见身份锚点：视觉年龄、脸部、体态、发型、基础服装和辨识特征；不写资产板版式",
    "psychologicalProfile": "心理侧写",
    "mbti": "MBTI 行为偏好",
    "enneagram": "九型人格与翼",
    "internalDesire": "内在渴望",
    "externalGoal": "外在目标",
    "flaw": "致命弱点",
    "actingStyle": "表演风格",
    "vocalQuirk": "语言特点",
    "sliders": {"压力阈值": 0, "情绪外显": 0},
    "variants": [{"name": "变体名", "description": "服装/妆发/伤势/战损/状态变化", "promptModifiers": "中文变体板提示词补充"}]
  }],
  "assets": [{
    "type": "location|prop",
    "name": "资产名",
    "description": "稳定制作身份。地点写空间骨架、出入口、陈设、材质、可拍区域和光线条件；道具写轮廓、尺寸、材质、持握/交互结构和功能边界",
    "tags": ["检索关键词"],
    "variants": [{"name": "变体名", "description": "地点损毁/道具破损/激活状态/使用状态变化", "promptModifiers": "中文变体板提示词补充"}]
  }]
}

不要在资产档案中生成角色板、场景板、道具板的版式提示词。资产板由统一策略结合风格锁和这些结构化事实派生；状态变化必须进入 variants。`,
};

const projectPlannedCharacterPromptFacts = (items: Array<{
  name: string;
  roleType?: string;
  brief?: string;
}>) => items.map((item) => ({
  name: item.name,
  ...(item.roleType?.trim() ? { roleType: item.roleType.trim() } : {}),
  ...(item.brief?.trim() ? { sourceFact: item.brief.trim() } : {}),
}));

const projectPlannedAssetPromptFacts = (items: Array<{
  name: string;
  brief?: string;
}>) => items.map((item) => ({
  name: item.name,
  ...(item.brief?.trim() ? { sourceFact: item.brief.trim() } : {}),
}));

const normalizeIncomingVariants = (
  variants: any[] | undefined,
) => (Array.isArray(variants) ? variants : [])
  .filter((variant) => variant?.name || variant?.description || variant?.promptModifiers)
  .map((variant) => ({
    id: String(variant.id || `variant-${Date.now()}-${crypto.randomUUID()}`),
    name: String(variant.name || variant.description || "状态变体").trim(),
    description: String(variant.description || "").trim(),
    promptModifiers: String(variant.promptModifiers || "").trim(),
    imageUrl: variant.imageUrl ? String(variant.imageUrl) : undefined,
  }));

const mergeAssetVariants = (
  existing: any[] | undefined,
  incoming: any[] | undefined,
) => {
  const normalizedExisting = Array.isArray(existing) ? existing : [];
  const incomingVariants = normalizeIncomingVariants(incoming);
  if (incomingVariants.length === 0) return normalizedExisting;
  const existingNames = new Set(normalizedExisting.map((variant) => String(variant.name || "").trim()).filter(Boolean));
  return [
    ...normalizedExisting,
    ...incomingVariants.filter((variant) => !existingNames.has(variant.name)),
  ];
};

export const executeAssetDetailStage = async (
  stage: ProductionStageRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const plannedCharacters = project.plannedCharacters || [];
  const plannedLocations = project.plannedLocations || [];
  const plannedProps = project.plannedProps || [];
  const loadedTemplate = await loadProductionPromptTemplate("production.assetDetail", productionAssetDetailTemplate);
  const prompt = renderPromptTemplate(loadedTemplate.template, {
    projectContext: projectContext(project, stage),
    revisionGuidance: revisionGuidance(stage),
    plannedCharacters: compactJson(projectPlannedCharacterPromptFacts(plannedCharacters)),
    plannedLocations: compactJson(projectPlannedAssetPromptFacts(plannedLocations)),
    plannedProps: compactJson(projectPlannedAssetPromptFacts(plannedProps)),
  });

  const response = await generateStageAIContent(stage, {
    prompt,
    requireJson: true,
    schema: {
      type: Type.OBJECT,
      properties: {
        characters: { type: Type.ARRAY, items: { type: Type.OBJECT } },
        assets: { type: Type.ARRAY, items: { type: Type.OBJECT } },
      },
      required: ["characters", "assets"],
    },
  });
  const data = parseResult<any>(response, { characters: [], assets: [] });

  const incomingCharacters = (data.characters || []).filter((character: any) => character?.name);
  const incomingCharacterByName = new Map(incomingCharacters.map((character: any) => [character.name, character]));
  const existingCharNames = new Set((project.characters || []).map((character) => character.name));
  const characters: Character[] = [
    ...(project.characters || []).map((existingCharacter: any) => {
      const incomingCharacter: any = incomingCharacterByName.get(existingCharacter.name);
      if (!incomingCharacter) return existingCharacter;
      return {
        ...existingCharacter,
        visualIdentity: existingCharacter.visualIdentity || incomingCharacter.visualIdentity || "",
        psychologicalProfile: existingCharacter.psychologicalProfile || incomingCharacter.psychologicalProfile || "",
        mbti: existingCharacter.mbti || incomingCharacter.mbti || "",
        enneagram: existingCharacter.enneagram || incomingCharacter.enneagram || "",
        internalDesire: existingCharacter.internalDesire || incomingCharacter.internalDesire || "",
        externalGoal: existingCharacter.externalGoal || incomingCharacter.externalGoal || "",
        flaw: existingCharacter.flaw || incomingCharacter.flaw || "",
        actingStyle: existingCharacter.actingStyle || incomingCharacter.actingStyle || "",
        vocalQuirk: existingCharacter.vocalQuirk || incomingCharacter.vocalQuirk || "",
        sliders: Object.keys(existingCharacter.sliders || {}).length ? existingCharacter.sliders : incomingCharacter.sliders || {},
        variants: mergeAssetVariants(existingCharacter.variants, incomingCharacter.variants),
      };
    }),
    ...incomingCharacters
      .filter((character: any) => character.name && !existingCharNames.has(character.name))
      .map((character: any) => ({
        id: `char-${Date.now()}-${crypto.randomUUID()}`,
        name: character.name,
        visualIdentity: character.visualIdentity || "",
        psychologicalProfile: character.psychologicalProfile || "",
        mbti: character.mbti || "",
        enneagram: character.enneagram || "",
        internalDesire: character.internalDesire || "",
        externalGoal: character.externalGoal || "",
        flaw: character.flaw || "",
        actingStyle: character.actingStyle || "",
        vocalQuirk: character.vocalQuirk || "",
        sliders: character.sliders || {},
        variants: mergeAssetVariants([], character.variants),
      })),
  ];

  const incomingAssets = (data.assets || []).filter((asset: any) => asset?.name && ["location", "prop"].includes(asset.type));
  const incomingAssetByKey = new Map(incomingAssets.map((asset: any) => [`${asset.type}:${asset.name}`, asset]));
  const existingAssetNames = new Set((project.assets || []).map((asset) => `${asset.type}:${asset.name}`));
  const assets: Asset[] = [
    ...(project.assets || []).map((existingAsset: any) => {
      const incomingAsset: any = incomingAssetByKey.get(`${existingAsset.type}:${existingAsset.name}`);
      if (!incomingAsset) return existingAsset;
      return {
        ...existingAsset,
        description: existingAsset.description || incomingAsset.description || "",
        tags: existingAsset.tags?.length ? existingAsset.tags : incomingAsset.tags || [],
        variants: mergeAssetVariants(existingAsset.variants, incomingAsset.variants),
      };
    }),
    ...incomingAssets
      .filter((asset: any) => asset.name && ["location", "prop"].includes(asset.type) && !existingAssetNames.has(`${asset.type}:${asset.name}`))
      .map((asset: any) => ({
        id: `${asset.type}-${Date.now()}-${crypto.randomUUID()}`,
        type: asset.type,
        name: asset.name,
        description: asset.description || "",
        tags: asset.tags || [],
        variants: mergeAssetVariants([], asset.variants),
      })),
  ];

  await updateProject({
    characters,
    assets,
    plannedCharacters: plannedCharacters.map((item) => ({ ...item, isDetailed: true })),
    plannedLocations: plannedLocations.map((item) => ({ ...item, isDetailed: true })),
    plannedProps: plannedProps.map((item) => ({ ...item, isDetailed: true })),
  });
  const updatedProject = {
    ...project,
    characters,
    assets,
    plannedCharacters: plannedCharacters.map((item) => ({ ...item, isDetailed: true })),
    plannedLocations: plannedLocations.map((item) => ({ ...item, isDetailed: true })),
    plannedProps: plannedProps.map((item) => ({ ...item, isDetailed: true })),
  };
  const assetBoardPlan = buildVideoStoryboardAssetBoardPlan(updatedProject);

  return {
    summary: `已补全资产档案：角色 ${characters.length} 个，资产 ${assets.length} 个。`,
    artifacts: [
      makeArtifact("character", "project.characters", "详细角色档案", characters.map((character) => character.id)),
      makeArtifact("location", "project.assets[type=location]", "详细场景资产", assets.filter((asset) => asset.type === "location").map((asset) => asset.id)),
      makeArtifact("prop", "project.assets[type=prop]", "详细道具资产", assets.filter((asset) => asset.type === "prop").map((asset) => asset.id)),
      makeArtifact("asset_board_plan", "project.videoStoryboardAssetBoardPlan", "AI 视频角色板/场景板/道具板/变体板计划", [project.id]),
    ],
    qaReports: createAssetDetailQAReports(updatedProject, assetBoardPlan),
    ...aiTrace(stage, prompt, response, loadedTemplate.trace),
    outputSnapshot: { characters, assets, assetBoardPlan },
  };
};
