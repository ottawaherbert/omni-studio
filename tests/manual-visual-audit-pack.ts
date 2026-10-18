import fs from "node:fs";
import path from "node:path";
import { collectProjectAssetsForContext } from "../src/utils/projectAssetContext";

type Args = {
  projectId: string;
  episodeId: string;
  baseUrl: string;
};

const parseArgs = (): Args => {
  const rawArgs = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) rawArgs.set(match[1], match[2]);
  }
  return {
    projectId: rawArgs.get("projectId") || "1780698638711",
    episodeId: rawArgs.get("episodeId") || "17807018642765",
    baseUrl: rawArgs.get("baseUrl") || "http://127.0.0.1:3000",
  };
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${url} failed ${response.status}: ${text.slice(0, 240)}`);
  return JSON.parse(text) as T;
};

const compact = (value?: string) => (value || "").trim();

const ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true });

const unique = <T>(values: T[]) => Array.from(new Set(values));

const assetPrompt = (kind: string, name: string, description: string, variantName: string, variantDescription: string) => [
  `中文视觉验收资产图，${kind}「${name}」。`,
  description ? `资产设定：${description}。` : "",
  variantName ? `变体：${variantName}。${variantDescription}` : "",
  "竖屏构图，主体清楚，外观、材质、身份锚点和关键细节必须可辨认。",
  "不要出现字幕、水印、UI、无关角色或额外剧情。",
].filter(Boolean).join(" ");

const shotPrompt = (episodeTitle: string, scene: any, shot: any, index: number) => [
  `中文分镜验收图，第 ${index} 镜，项目分集「${episodeTitle}」，场景「${scene.title}」。`,
  `镜头文本：${shot.visualAction || ""}`,
  shot.blocking ? `调度：${shot.blocking}` : "",
  shot.composition ? `构图：${shot.composition}` : "",
  shot.continuityNote ? `连续性：${shot.continuityNote}` : "",
  `最终图片提示词：${shot.imagePrompt || ""}`,
  "严格只生成本镜头画面，不生成视频，不添加字幕、水印、UI 或额外剧情。",
].filter(Boolean).join("\n");

const main = async () => {
  const args = parseArgs();
  const project = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}`);
  const episode = await fetchJson<any>(`${args.baseUrl}/api/projects/${args.projectId}/episodes/${args.episodeId}`);
  const outputDir = path.join(process.cwd(), "OMNI_Workspace", "visual-audits", args.projectId, args.episodeId);
  ensureDir(outputDir);
  ensureDir(path.join(outputDir, "assets", "characters"));
  ensureDir(path.join(outputDir, "assets", "locations"));
  ensureDir(path.join(outputDir, "assets", "props"));
  ensureDir(path.join(outputDir, "shots"));

  const usedCharacterIds = new Set<string>();
  const usedLocationIds = new Set<string>();
  const usedPropIds = new Set<string>();
  const shots: any[] = [];
  for (const scene of episode.scenes || []) {
    for (const shot of scene.shots || []) {
      shots.push({ scene, shot });
      (shot.characterIdsInShot || []).forEach((id: string) => usedCharacterIds.add(id));
      if (shot.locationId) usedLocationIds.add(shot.locationId);
      (shot.propIds || []).forEach((id: string) => usedPropIds.add(id));
    }
  }

  const characters = [
    ...(project.characters || []),
    ...(project.plannedCharacters || []).filter((character: any) =>
      !(project.characters || []).some((detailed: any) => detailed.id === character.id),
    ),
  ];
  const locations = collectProjectAssetsForContext(project, "location");
  const props = collectProjectAssetsForContext(project, "prop");

  const assetEntries = [
    ...characters.filter((character: any) => usedCharacterIds.has(character.id)).flatMap((character: any) => {
      const description = compact(character.multiViewPrompt)
        || compact(character.visualIdentity)
        || compact(character.appearance)
        || compact(character.brief);
      const variants = Array.isArray(character.variants) && character.variants.length > 0
        ? character.variants
        : [
            { id: "identity", name: "身份肖像", description: "突出角色身份、年龄、性别、服装与气质。" },
            { id: "performance", name: "表演状态", description: "突出本集关键情绪、眼神和身体动作。" },
          ];
      return variants.map((variant: any) => ({
        kind: "character",
        id: character.id,
        name: character.name,
        variantId: variant.id || variant.name || "default",
        variantName: variant.name || "默认变体",
        prompt: assetPrompt("角色", character.name, description, variant.name || "", compact(variant.description || variant.promptModifiers)),
        outputPath: path.join(outputDir, "assets", "characters", `${character.id}-${variant.id || variant.name || "default"}.png`),
      }));
    }),
    ...locations.filter((asset: any) => usedLocationIds.has(asset.id)).flatMap((asset: any) => {
      const variants = Array.isArray(asset.variants) && asset.variants.length > 0
        ? asset.variants
        : [
            { id: "establishing", name: "空间建立图", description: "交代空间结构、入口、主要调度方向。" },
            { id: "vertical", name: "竖屏拍摄变体", description: "突出手机端可读构图和可拍摄机位。" },
          ];
      return variants.map((variant: any) => ({
        kind: "location",
        id: asset.id,
        name: asset.name,
        variantId: variant.id || variant.name || "default",
        variantName: variant.name || "默认变体",
        prompt: assetPrompt("地点", asset.name, compact(asset.prompt) || compact(asset.description), variant.name || "", compact(variant.description || variant.promptModifiers)),
        outputPath: path.join(outputDir, "assets", "locations", `${asset.id}-${variant.id || variant.name || "default"}.png`),
      }));
    }),
    ...props.filter((asset: any) => usedPropIds.has(asset.id)).flatMap((asset: any) => {
      const variants = Array.isArray(asset.variants) && asset.variants.length > 0
        ? asset.variants
        : [
            { id: "clean", name: "单独清晰图", description: "道具居中，形状、材质、纹理和尺寸关系可辨认。" },
            { id: "in-use", name: "持有/使用状态", description: "展示角色手部持有或使用该道具的方式。" },
          ];
      return variants.map((variant: any) => ({
        kind: "prop",
        id: asset.id,
        name: asset.name,
        variantId: variant.id || variant.name || "default",
        variantName: variant.name || "默认变体",
        prompt: assetPrompt("道具", asset.name, compact(asset.prompt) || compact(asset.description), variant.name || "", compact(variant.description || variant.promptModifiers)),
        outputPath: path.join(outputDir, "assets", "props", `${asset.id}-${variant.id || variant.name || "default"}.png`),
      }));
    }),
  ];

  const shotEntries = shots.map(({ scene, shot }, index) => ({
    kind: "shot",
    sceneId: scene.id,
    sceneTitle: scene.title,
    id: shot.id,
    order: index + 1,
    visualAction: shot.visualAction,
    imagePrompt: shot.imagePrompt,
    prompt: shotPrompt(episode.title, scene, shot, index + 1),
    outputPath: path.join(outputDir, "shots", `${String(index + 1).padStart(2, "0")}-${shot.id}.png`),
  }));

  const manifest = {
    projectId: args.projectId,
    projectTitle: project.title,
    episodeId: args.episodeId,
    episodeTitle: episode.title,
    outputDir,
    policy: "中文 imagePrompt/videoPrompt；严格视觉验收不生成视频。",
    assetCount: assetEntries.length,
    shotCount: shotEntries.length,
    usedAssets: {
      characterIds: unique([...usedCharacterIds]),
      locationIds: unique([...usedLocationIds]),
      propIds: unique([...usedPropIds]),
    },
    assets: assetEntries,
    shots: shotEntries,
  };

  const storyboardText = [
    `# ${project.title} / ${episode.title} 严格视觉验收分镜文本`,
    "",
    `项目 ID: ${args.projectId}`,
    `分集 ID: ${args.episodeId}`,
    "提示词策略: 中文 imagePrompt/videoPrompt；不生成视频。",
    "",
    ...shotEntries.flatMap((entry) => [
      `## ${String(entry.order).padStart(2, "0")} ${entry.sceneTitle}`,
      "",
      `shotId: ${entry.id}`,
      "",
      `镜头文本: ${entry.visualAction || ""}`,
      "",
      `图片提示词: ${entry.imagePrompt || ""}`,
      "",
      `输出图片: ${entry.outputPath}`,
      "",
    ]),
  ].join("\n");

  fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "storyboard-text.md"), storyboardText);
  console.log(JSON.stringify({
    outputDir,
    manifestPath: path.join(outputDir, "manifest.json"),
    storyboardTextPath: path.join(outputDir, "storyboard-text.md"),
    assetCount: assetEntries.length,
    shotCount: shotEntries.length,
    usedAssets: manifest.usedAssets,
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
