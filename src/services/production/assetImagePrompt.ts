import { formatPromptValue } from "../../utils/projectUtils";

export type AssetImagePromptType = "character" | "location" | "prop";

const assetTask: Record<AssetImagePromptType, string> = {
  character: "角色身份生产参考图",
  location: "场景空间生产参考图",
  prop: "道具结构生产参考图",
};

export const buildAssetImagePrompt = ({
  assetType,
  assetName,
  description,
  visualStyle,
  variantDescription,
  variantModifiers,
}: {
  assetType: AssetImagePromptType;
  assetName: string;
  description?: string;
  visualStyle?: string;
  variantDescription?: string;
  variantModifiers?: string;
}) => [
  `【任务】生成${assetTask[assetType]}：${formatPromptValue(assetName)}`,
  formatPromptValue(description) ? `【可见设计】\n${formatPromptValue(description)}` : "",
  formatPromptValue(variantDescription) ? `【当前状态】\n${formatPromptValue(variantDescription)}` : "",
  formatPromptValue(variantModifiers) ? `【仅本状态附加要求】\n${formatPromptValue(variantModifiers)}` : "",
  formatPromptValue(visualStyle) ? `【视觉锚点】\n${formatPromptValue(visualStyle)}` : "",
].filter(Boolean).join("\n\n");

export const buildMultiViewImagePrompt = ({
  assetType,
  assetName,
  description,
  visualStyle,
}: {
  assetType: AssetImagePromptType;
  assetName: string;
  description?: string;
  visualStyle?: string;
}) => [
  `【任务】生成${assetType === "character" ? "角色身份" : assetType === "location" ? "场景空间" : "道具设计"}多视图板：${formatPromptValue(assetName)}`,
  assetType === "location"
    ? "【版面内容】空间总览、反向机位、入口出口、固定结构与关键材质细节；各视图必须属于同一空间布局。"
    : "【版面内容】正面、侧面、背面与关键细节特写；各视图必须是同一身份、同一比例和同一材质状态。",
  formatPromptValue(description) ? `【可见设计】\n${formatPromptValue(description)}` : "",
  formatPromptValue(visualStyle) ? `【视觉锚点】\n${formatPromptValue(visualStyle)}` : "",
].filter(Boolean).join("\n\n");
