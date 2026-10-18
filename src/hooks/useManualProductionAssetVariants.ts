import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { generateAIContent } from "../clients/aiClient";
import type { PromptEditorConfirmMetadata } from "../components/PromptEditorModal";
import type { Episode, Project, Scene } from "../clients/domainTypes";
import {
  buildManualProductionVariantUpdate,
  buildManualProductionAssetReadModel,
  type ManualProductionSceneState,
  type ManualProductionVariantDraft,
} from "../clients/productionAssetWorkflowClient";
import { gatherContextOptions } from "../utils/contextMapper";
import { safeParseAIResponse } from "../utils/aiParser";
import { summarizeUnknownError } from "../utils/logging";

export interface ManualProductionVariantPromptRequest {
  templateId: "productionAssetVariant";
  title: string;
  variables: Record<string, string>;
  contextOptions: { id: string; label: string; value: string }[];
  defaultSelectedContextIds: string[];
}

export interface ManualProductionVariantCandidate {
  state: ManualProductionSceneState;
  draft: ManualProductionVariantDraft;
  finalPrompt: string;
  selectedSkillIds: string[];
  selectedContextIds: string[];
}

export const useManualProductionAssetVariants = ({
  project,
  episode,
  scene,
  updateProject,
  updateScene,
}: {
  project: Project;
  episode: Episode;
  scene: Scene;
  updateProject: (updates: Partial<Project>) => Promise<void>;
  updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string) => Promise<void>;
}) => {
  const [targetState, setTargetState] = useState<ManualProductionSceneState | null>(null);
  const [promptRequest, setPromptRequest] = useState<ManualProductionVariantPromptRequest | null>(null);
  const [candidate, setCandidate] = useState<ManualProductionVariantCandidate | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const context = useMemo(() => gatherContextOptions(project, "generate_visuals"), [project]);

  const prepareVariant = (state: ManualProductionSceneState) => {
    if (state.variantId) {
      toast.error("当前场景已经绑定状态变体。");
      return;
    }
    const readModel = buildManualProductionAssetReadModel({ project, episode, scene });
    const baseBoard = readModel.assetBoards.find((item) => item.assetId === state.assetId && !item.variantId);
    if (!baseBoard) {
      toast.error("当前场景没有该资产的基础身份板。");
      return;
    }
    const character = state.assetType === "character" ? project.characters.find((item) => item.id === state.assetId) : undefined;
    const asset = state.assetType === "character" ? undefined : project.assets.find((item) => item.id === state.assetId);
    const baseDescription = character
      ? character.visualIdentity || ""
      : asset?.description || "";
    setTargetState(state);
    setPromptRequest({
      templateId: "productionAssetVariant",
      title: `${state.assetName}状态变体 - 提示词确认`,
      variables: {
        assetType: state.assetType,
        assetName: state.assetName,
        baseDescription,
        sceneTitle: scene.title,
        scriptContent: scene.script || scene.description,
        stateSummary: state.stateSummary,
      },
      contextOptions: context.options,
      defaultSelectedContextIds: [],
    });
  };

  const executePrompt = async (
    finalPrompt: string,
    _userIntent?: string,
    metadata?: PromptEditorConfirmMetadata,
  ) => {
    if (!targetState || !promptRequest || isRunning) return;
    setIsRunning(true);
    try {
      const { Type } = await import("../clients/aiSchemaClient");
      const response = await generateAIContent({
        prompt: finalPrompt,
        requireJson: true,
        schema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            description: { type: Type.STRING },
            promptModifiers: { type: Type.STRING },
          },
        },
      });
      const parsed = safeParseAIResponse<Partial<ManualProductionVariantDraft>>(response, {});
      const draft = {
        name: String(parsed.name || "").trim(),
        description: String(parsed.description || "").trim(),
        promptModifiers: String(parsed.promptModifiers || "").trim(),
      };
      if (!draft.name || !draft.description) throw new Error("模型未返回可采用的状态名称和可见差异。");
      setCandidate({
        state: targetState,
        draft,
        finalPrompt,
        selectedSkillIds: metadata?.selectedSkillIds || [],
        selectedContextIds: metadata?.selectedContextIds || [],
      });
      setPromptRequest(null);
    } catch (error) {
      console.error("Manual production variant generation failed:", summarizeUnknownError(error));
      toast.error(error instanceof Error ? error.message : "状态变体生成失败");
    } finally {
      setIsRunning(false);
    }
  };

  const adoptCandidate = async () => {
    if (!candidate) return;
    try {
      const update = buildManualProductionVariantUpdate({
        project,
        episode,
        scene,
        assetId: candidate.state.assetId,
        draft: candidate.draft,
        finalPrompt: candidate.finalPrompt,
        selectedSkillIds: candidate.selectedSkillIds,
        selectedContextIds: candidate.selectedContextIds,
      });
      await updateProject(update.projectUpdates);
      await updateScene(scene.id, update.sceneUpdates, episode.id);
      setCandidate(null);
      setTargetState(null);
      toast.success("状态变体已创建并绑定当前场景");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "状态变体采用失败");
    }
  };

  return {
    promptRequest,
    setPromptRequest,
    candidate,
    setCandidate,
    isRunning,
    prepareVariant,
    executePrompt,
    adoptCandidate,
  };
};
