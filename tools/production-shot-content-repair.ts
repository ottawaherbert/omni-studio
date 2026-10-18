import { createHash } from "node:crypto";

import { dbHelpers } from "../src/server/db";
import { createOperatorArtifact } from "../src/services/operator/artifacts";
import { createOperatorRunRecord } from "../src/services/operator/runs";
import { OPERATOR_HANDBOOK_VERSION } from "../src/services/operator/types";
import {
  composePromptBlocks,
  promptBlocksFromText,
  type PromptCompositionManifest,
} from "../src/services/production/promptComposition";
import type { Character, Episode, Project, Scene, Shot } from "../src/types/project";
import { formatVisualCreativeVision } from "../src/utils/projectUtils";

const CONTRACT_VERSION = "production-shot-content-repair.v1";
const MAX_CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const CIRCUIT_FAILURES = 3;
const ABSTRACT_PLACEHOLDER_PATTERN = /沿既定动线|执行目标|作出明确决定|遭遇代价|关系状态完成变化|空间或行动路线|人物按新决定|场景稳定在新尾状态|原定行动被迫|没有重复解释|可见角色[:：]/u;

type RepairOptions = {
  projectId: string;
  baseUrl: string;
  concurrency: number;
  sceneId?: string;
  dryRun: boolean;
};

type CandidateShot = {
  id: string;
  visualAction: string;
  characterIdsInShot: string[];
  propIds: string[];
};

type CandidatePayload = { shots: CandidateShot[] };
type QAIssue = { shotId?: string; code: string; message: string; repairInstruction?: string };
type QAPayload = { status: "passed" | "failed"; issues: QAIssue[] };
type ShotRepairPromptManifest = {
  phase: "producer" | "qa";
  attempt: number;
  manifest: PromptCompositionManifest;
};

class ShotRepairError extends Error {
  constructor(
    message: string,
    readonly sceneId: string,
    readonly issues: QAIssue[],
    readonly promptCompositionManifests: ShotRepairPromptManifest[] = [],
  ) {
    super(message);
    this.name = "ShotRepairError";
  }
}

const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const parseOptions = (): RepairOptions => {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? clean(args[index + 1]) : "";
  };
  const projectId = value("--project");
  if (!projectId) throw new Error("Usage: npm run repair:shot-content -- --project <projectId> [--base-url http://localhost:3000] [--concurrency 1|2]");
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(Number(value("--concurrency") || 2))));
  return {
    projectId,
    baseUrl: (value("--base-url") || "http://127.0.0.1:3000").replace(/\/$/, ""),
    concurrency,
    sceneId: value("--scene") || undefined,
    dryRun: args.includes("--dry-run"),
  };
};

const parseJsonObject = <T>(value: unknown): T => {
  const text = clean(value).replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model returned no JSON object.");
  return JSON.parse(text.slice(start, end + 1)) as T;
};

const characterGenderHint = (character: Character) => {
  const source = clean(character.multiViewPrompt || character.psychologicalProfile);
  if (/女性|女人|女孩|母亲|姐姐|妹妹/u.test(source)) return "female";
  if (/男性|男人|男孩|父亲|哥哥|弟弟/u.test(source)) return "male";
  return "unspecified";
};

const sceneContext = (project: Project, scene: Scene) => ({
  title: scene.title,
  description: scene.description,
  goal: scene.sceneGoal,
  valueShift: scene.valueShift,
  cliffhanger: scene.cliffhanger,
  location: project.assets.find((asset) => asset.id === scene.breakdown?.locationId)?.name || scene.breakdown?.locationId,
  characters: (scene.breakdown?.characterIds || []).map((id) => {
    const character = project.characters.find((item) => item.id === id);
    const activeVariantId = scene.breakdown?.assetVariantMap?.[id];
    const activeVariant = character?.variants?.find((variant) => variant.id === activeVariantId);
    return {
      id,
      name: character?.name || id,
      gender: character ? characterGenderHint(character) : "unspecified",
      activeVariant: activeVariant ? {
        id: activeVariant.id,
        name: activeVariant.name,
        description: activeVariant.description,
        promptModifiers: activeVariant.promptModifiers,
      } : undefined,
    };
  }),
  props: (scene.breakdown?.propIds || []).map((id) => ({ id, name: project.assets.find((item) => item.id === id)?.name || id })),
  scriptBlocks: (scene.scriptBlocks || []).map((block) => ({ type: block.type, content: block.content, linkedAssetId: block.linkedAssetId })),
});

const shotContext = (project: Project, shot: Shot) => ({
  id: shot.id,
  shotSize: shot.shotSize,
  cameraAngle: shot.cameraAngle,
  cameraMovement: shot.cameraMovement,
  focalLength: shot.focalLength,
  duration: shot.duration,
  motivation: shot.motivation,
  currentVisualAction: shot.visualAction,
  dialogueLines: shot.dialogueLines,
  currentCharacters: (shot.characterIdsInShot || []).map((id) => ({ id, name: project.characters.find((item) => item.id === id)?.name || id })),
  currentProps: (shot.propIds || []).map((id) => ({ id, name: project.assets.find((item) => item.id === id)?.name || id })),
});

const loadTextRoute = async (baseUrl: string, route: "storyboardGen" | "qcAnalyzer") => {
  const response = await fetch(`${baseUrl}/api/ai-config`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Unable to load AI config (${response.status}).`);
  const payload = await response.json() as { config?: { channels?: any[]; models?: any[]; routing?: Record<string, string> } };
  const config = payload.config || {};
  const model = (config.models || []).find((item) => item.id === config.routing?.[route]);
  const channel = (config.channels || []).find((item) => item.id === model?.channelId);
  if (!model || !channel || !model.modelId) throw new Error(`No text model configured for ${route}.`);
  if (!model.capabilities?.includes("text")) throw new Error(`${route} model does not declare text capability.`);
  if (!["openai", "deepseek", "minimax", "doubao"].includes(channel.type)) {
    throw new Error(`${route} channel ${channel.type} is not supported by the bounded repair worker.`);
  }
  return { provider: channel.type, channelId: channel.id, baseUrl: channel.baseUrl, modelId: model.modelId };
};

const callJsonModel = async <T>({
  baseUrl,
  route,
  prompt,
}: {
  baseUrl: string;
  route: Awaited<ReturnType<typeof loadTextRoute>>;
  prompt: string;
}): Promise<{ value: T; manifest: PromptCompositionManifest }> => {
  const composition = composePromptBlocks(promptBlocksFromText({
    prompt,
    blockIdPrefix: "shot_content_repair",
    source: "tools/production-shot-content-repair",
    purpose: "Shot 内容修复或质检",
  }));
  if (composition.manifest.issues.some((issue) => issue.code === "EMPTY_REQUIRED_BLOCK")) {
    throw new Error("Shot repair prompt is empty after prompt composition.");
  }
  let lastError: unknown;
  for (let transportAttempt = 1; transportAttempt <= 2; transportAttempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/proxy/openai-compatible`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: route.provider,
          channelId: route.channelId,
          baseUrl: route.baseUrl,
          body: {
            model: route.modelId,
            temperature: 0.25,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: composition.prompt }],
          },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = await response.json() as any;
      if (!response.ok) {
        const error = new Error(data.error || `Text provider failed (${response.status}).`) as Error & { retryable?: boolean };
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return {
        value: parseJsonObject<T>(data.choices?.[0]?.message?.content),
        manifest: composition.manifest,
      };
    } catch (error) {
      lastError = error;
      const explicitlyFinal = error instanceof Error && "retryable" in error && !(error as Error & { retryable?: boolean }).retryable;
      if (transportAttempt >= 2 || explicitlyFinal) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
};

const localCandidateIssues = (project: Project, scene: Scene, payload: CandidatePayload): QAIssue[] => {
  const sourceShots = scene.shots || [];
  const expectedIds = sourceShots.map((shot) => shot.id);
  const allowedCharacterIds = new Set(scene.breakdown?.characterIds || []);
  const allowedPropIds = new Set(scene.breakdown?.propIds || []);
  const candidates = Array.isArray(payload?.shots) ? payload.shots : [];
  const issues: QAIssue[] = [];
  if (candidates.length !== expectedIds.length) {
    issues.push({ code: "SHOT_COUNT_CHANGED", message: `Expected ${expectedIds.length} shots but received ${candidates.length}.` });
  }
  if (new Set(candidates.map((shot) => shot.id)).size !== candidates.length || candidates.some((shot) => !expectedIds.includes(shot.id))) {
    issues.push({ code: "SHOT_ID_SET_CHANGED", message: "Shot ids must remain unique and unchanged." });
  }
  for (const shot of candidates) {
    const action = clean(shot.visualAction);
    if (action.length < 12 || action.length > 240) {
      issues.push({ shotId: shot.id, code: "VISUAL_ACTION_LENGTH", message: "visualAction must be 12-240 characters." });
    }
    if (ABSTRACT_PLACEHOLDER_PATTERN.test(action)) {
      issues.push({ shotId: shot.id, code: "ABSTRACT_PLACEHOLDER", message: "visualAction still contains a non-shootable placeholder." });
    }
    const characterIds = Array.isArray(shot.characterIdsInShot) ? shot.characterIdsInShot : [];
    const propIds = Array.isArray(shot.propIds) ? shot.propIds : [];
    const unknownCharacterIds = characterIds.filter((id) => !allowedCharacterIds.has(id));
    if (unknownCharacterIds.length) {
      issues.push({ shotId: shot.id, code: "UNKNOWN_CHARACTER", message: `Remove undeclared character ids: ${unknownCharacterIds.join(", ")}.` });
    }
    const unknownPropIds = propIds.filter((id) => !allowedPropIds.has(id));
    if (unknownPropIds.length) {
      issues.push({ shotId: shot.id, code: "UNKNOWN_PROP", message: `Remove undeclared prop ids: ${unknownPropIds.join(", ")}.` });
    }
    const dialogueSpeakers = (sourceShots.find((item) => item.id === shot.id)?.dialogueLines || []).map((line) => line.characterId).filter(Boolean);
    if (dialogueSpeakers.some((id) => !characterIds.includes(id!))) {
      issues.push({ shotId: shot.id, code: "DIALOGUE_SPEAKER_MISSING", message: "Dialogue speaker must remain visible in characterIdsInShot." });
    }
  }
  return issues;
};

const producerPrompt = (
  project: Project,
  scene: Scene,
  sourceShots: Shot[],
  previous?: CandidatePayload,
  issues: QAIssue[] = [],
) => [
  "你是电影分镜内容修复 Agent。只修复 Shot 的可拍内容合同，不改故事事实或摄影合同。",
  "只返回 JSON：{\"shots\":[{\"id\":\"...\",\"visualAction\":\"...\",\"characterIdsInShot\":[\"...\"],\"propIds\":[\"...\"]}]}。",
  "硬规则：Shot ID 与数量完全不变；只使用 scene.characters/scene.props 中声明的 ID；地点、剧情、对白、景别、机位、焦距、运镜、时长不变；不得新增设备、屏幕、车辆、武器、服装或人物。候选补丁不包含 dialogueLines 和摄影字段，它们由系统原样保留；不要为了重复对白而把整句对白硬塞进 visualAction。",
  "每条 visualAction 必须是单一确定方案，写清谁在画面里、对哪个已声明实体做了什么可观察动作、出现什么可见状态；不得写执行目标、确认真相、作出决定、遭遇代价、关系变化、原计划受阻等抽象占位语；不得使用“或/或者/等动作”给导演留多选题。",
  "characterIdsInShot 必须和 visualAction 里实际出镜、可见的人物一致；录音、广播、照片、档案或台词中仅被提及的人物不算出镜。propIds 只列本镜实际可见的已声明道具，不要求每镜展示场内全部道具。角色 activeVariant 中已经声明的服装、伤妆和可穿戴装备属于角色资产，不作为独立 propId。visualAction 始终使用人物实名，禁止用“他/她/他们/她们”代指人物，避免多角色镜头身份错配。",
  `本次只返回以下 ${sourceShots.length} 个 Shot；不要返回其他 Shot：${sourceShots.map((shot) => shot.id).join("、")}`,
  JSON.stringify({ scene: sceneContext(project, scene), shots: sourceShots.map((shot) => shotContext(project, shot)), previous, qaIssues: issues }),
].join("\n");

const qaPrompt = (project: Project, scene: Scene, candidate: CandidatePayload) => [
  "你是独立的电影分镜可拍性 QA Agent，不负责美化 producer 输出。",
  "只返回 JSON：{\"status\":\"passed|failed\",\"issues\":[{\"shotId\":\"...\",\"code\":\"...\",\"message\":\"...\",\"repairInstruction\":\"...\"}]}。",
  "候选只允许修改 visualAction、characterIdsInShot、propIds；dialogueLines、镜头规格和时长不在候选 JSON 中，由系统原样保留。禁止因为候选没有 dialogueLines 字段而报告对白缺失，也禁止要求每镜展示 scene.props 的全部道具。",
  "检查：每条是否能直接画成唯一画面；动作是否有明确主体、物理动作和可见状态；出镜人物/代词/可见道具是否只来自锁定清单；是否擅自新增英雄资产；相邻镜头是否存在明确矛盾的动作、位置和道具状态；禁止把抽象意图当动作。角色 activeVariant 明确声明的服装、伤妆、管线和可穿戴装备属于角色资产，不是未授权场景道具，也不应进入 propIds。便携道具暂时不在某个构图内、未列入该镜 propIds，不等于道具消失或连续性中断；只有持有人、来源、状态或交接互相矛盾才报告 continuity。场景固有结构和普通陈设可以作为背景，但不能成为未声明的剧情关键道具。任何一项不满足都 failed。",
  JSON.stringify({ scene: sceneContext(project, scene), sourceShots: (scene.shots || []).map((shot) => shotContext(project, shot)), candidate }),
].join("\n");

const repairScene = async ({
  project,
  scene,
  baseUrl,
  producerRoute,
  qaRoute,
}: {
  project: Project;
  scene: Scene;
  baseUrl: string;
  producerRoute: Awaited<ReturnType<typeof loadTextRoute>>;
  qaRoute: Awaited<ReturnType<typeof loadTextRoute>>;
}) => {
  let previous: CandidatePayload | undefined;
  let previousFingerprint = "";
  let issues: QAIssue[] = [];
  const promptCompositionManifests: ShotRepairPromptManifest[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const sourceShots = scene.shots || [];
    const failedShotIds = new Set(issues.map((issue) => issue.shotId).filter((id): id is string => Boolean(id)));
    for (const issue of issues) {
      const text = `${issue.message} ${issue.repairInstruction || ""}`;
      for (const match of text.matchAll(/shot[-_ ]?(\d+)/giu)) {
        const suffix = `shot-${String(match[1]).padStart(2, "0")}`;
        const referenced = sourceShots.find((shot) => shot.id.endsWith(suffix));
        if (referenced) failedShotIds.add(referenced.id);
      }
      if (/continuity|承接|相邻|前镜|后镜|道具状态|持有|交接/iu.test(`${issue.code} ${text}`) && issue.shotId) {
        const index = sourceShots.findIndex((shot) => shot.id === issue.shotId);
        if (index > 0) failedShotIds.add(sourceShots[index - 1].id);
        if (index >= 0 && index < sourceShots.length - 1) failedShotIds.add(sourceShots[index + 1].id);
      }
    }
    const canTargetRepair = Boolean(previous) && failedShotIds.size > 0 && issues.every((issue) => Boolean(issue.shotId));
    const requestedShots = canTargetRepair ? sourceShots.filter((shot) => failedShotIds.has(shot.id)) : sourceShots;
    const generatedCall = await callJsonModel<CandidatePayload>({
      baseUrl,
      route: producerRoute,
      prompt: producerPrompt(
        project,
        scene,
        requestedShots,
        previous ? { shots: previous.shots.filter((shot) => failedShotIds.has(shot.id)) } : undefined,
        issues,
      ),
    });
    promptCompositionManifests.push({ phase: "producer", attempt, manifest: generatedCall.manifest });
    const generated = generatedCall.value;
    const candidate = canTargetRepair && previous
      ? {
          shots: Array.from(new Map([
            ...previous.shots.map((shot) => [shot.id, shot] as const),
            ...(Array.isArray(generated.shots) ? generated.shots : []).map((shot) => [shot.id, shot] as const),
          ]).values()),
        }
      : generated;
    const localIssues = localCandidateIssues(project, scene, candidate);
    let remoteQA: QAPayload;
    if (localIssues.length) {
      remoteQA = { status: "failed", issues: localIssues };
    } else {
      const qaCall = await callJsonModel<QAPayload>({ baseUrl, route: qaRoute, prompt: qaPrompt(project, scene, candidate) });
      promptCompositionManifests.push({ phase: "qa", attempt, manifest: qaCall.manifest });
      remoteQA = qaCall.value;
    }
    issues = localIssues.length ? localIssues : (Array.isArray(remoteQA.issues) ? remoteQA.issues : []);
    if (!localIssues.length && remoteQA.status === "passed" && issues.length === 0) {
      return { sceneId: scene.id, shots: candidate.shots, attempts: attempt, promptCompositionManifests };
    }
    const fingerprint = hash(issues.map((issue) => `${issue.shotId || "scene"}:${issue.code}`).sort());
    if (fingerprint === previousFingerprint) {
      throw new ShotRepairError(`same_issue_loop:${scene.id}:${issues.map((issue) => issue.code).join(",")}`, scene.id, issues, promptCompositionManifests);
    }
    previousFingerprint = fingerprint;
    previous = candidate;
  }
  throw new ShotRepairError(`repair_budget_exhausted:${scene.id}:${issues.map((issue) => issue.code).join(",")}`, scene.id, issues, promptCompositionManifests);
};

const rebuiltPrompt = (project: Project, shot: Shot, visualAction: string, kind: "image" | "video") => {
  const characters = (shot.characterIdsInShot || []).map((id) => project.characters.find((item) => item.id === id)?.name || id).join("、");
  const props = (shot.propIds || []).map((id) => project.assets.find((item) => item.id === id)?.name || id).join("、");
  const camera = [shot.shotSize, shot.cameraAngle, shot.cameraMovement, shot.focalLength].filter(Boolean).join("，");
  const visualStyle = formatVisualCreativeVision(project.creativeVision);
  if (kind === "image") return [
    visualStyle,
    `${camera}，${shot.lighting || "继承场景布光"}。${visualAction}。`,
    characters ? `角色：${characters}。` : "",
    props ? `道具：${props}。` : "",
    "空间、身份、服装、道具归属和连续性保持锁定。",
  ].filter(Boolean).join("\n");
  return [
    visualStyle,
    `${shot.duration || 8}秒视频单元，${camera}。${visualAction}。`,
    "动作起点和尾点明确，表演符合已确认角色与场景，视线、轴线、水流与道具状态连续，不改变角色身份。",
  ].filter(Boolean).join("\n");
};

const main = async () => {
  const options = parseOptions();
  const project = dbHelpers.getProjectById(options.projectId) as Project | null;
  if (!project) throw new Error(`Project not found: ${options.projectId}`);
  const producerRoute = await loadTextRoute(options.baseUrl, "storyboardGen");
  const qaRoute = await loadTextRoute(options.baseUrl, "qcAnalyzer");
  const productionEpisodes = project.episodes as unknown as Episode[];
  const allScenes = productionEpisodes.flatMap((episode) => episode.scenes || []).filter((scene) => (scene.shots || []).length > 0);
  const scenes = options.sceneId ? allScenes.filter((scene) => scene.id === options.sceneId) : allScenes;
  if (!scenes.length) throw new Error(options.sceneId ? `Scene not found: ${options.sceneId}` : "Project contains no scenes with shots.");
  const reusableDrafts = options.dryRun
    ? new Map<string, any>()
    : new Map(
        dbHelpers.listOperatorArtifacts({ projectId: project.id })
          .filter((artifact) => artifact.kind === "shot_patch" && artifact.status === "approved")
          .filter((artifact) => (artifact.data as any)?.contractVersion === CONTRACT_VERSION && (artifact.data as any)?.draftOnly === true)
          .filter((artifact) => {
            const data = artifact.data as any;
            const scene = scenes.find((item) => item.id === data?.sceneId);
            return scene && data?.sourceHash === hash(scene.shots || []);
          })
          .map((artifact) => {
            const data = artifact.data as any;
            return [data.sceneId, data] as const;
          }),
      );
  const run = dbHelpers.saveOperatorRun(createOperatorRunRecord({
    projectId: project.id,
    provider: "codex",
    mode: "repair",
    status: "running",
    handbookVersion: OPERATOR_HANDBOOK_VERSION,
    userRequest: `${CONTRACT_VERSION}: 在有限返工预算内修复不可拍或抽象的 Shot 内容合同${options.dryRun ? "（只读试跑）" : ""}。`,
    scope: { projectId: project.id, sceneIds: scenes.map((scene) => scene.id), shotIds: scenes.flatMap((scene) => (scene.shots || []).map((shot) => shot.id)) },
  }));
  dbHelpers.appendOperatorRunEvent(run.id, {
    type: "plan_created",
    message: `准备修复 ${scenes.length} 场 Shot 内容；复用 ${reusableDrafts.size} 场已通过草稿；每场最多 ${MAX_ATTEMPTS} 次，同错立即停止。`,
    entityIds: [project.id],
  });
  const repaired: Awaited<ReturnType<typeof repairScene>>[] = Array.from(reusableDrafts.values()).map((data) => ({
    sceneId: data.sceneId,
    shots: data.patches,
    attempts: 0,
    promptCompositionManifests: data.promptCompositionManifests || [],
  }));
  const pendingScenes = scenes.filter((scene) => !reusableDrafts.has(scene.id));
  let consecutiveFailures = 0;
  for (let index = 0; index < pendingScenes.length; index += options.concurrency) {
    const batch = pendingScenes.slice(index, index + options.concurrency);
    const results = await Promise.all(batch.map(async (scene) => {
      try {
        return { status: "passed" as const, value: await repairScene({ project, scene, baseUrl: options.baseUrl, producerRoute, qaRoute }) };
      } catch (error) {
        return {
          status: "failed" as const,
          scene,
          error: error instanceof Error ? error.message : String(error),
          issues: error instanceof ShotRepairError ? error.issues : [],
          promptCompositionManifests: error instanceof ShotRepairError ? error.promptCompositionManifests : [],
        };
      }
    }));
    for (const result of results) {
      if (result.status === "passed") {
        repaired.push(result.value);
        consecutiveFailures = 0;
        if (!options.dryRun) {
          const sourceScene = scenes.find((scene) => scene.id === result.value.sceneId)!;
          const draft = createOperatorArtifact({
            runId: run.id,
            projectId: project.id,
            kind: "shot_patch",
            targetPath: `episodes.scenes.${result.value.sceneId}.shots`,
            entityIds: [project.id, result.value.sceneId, ...result.value.shots.map((shot) => shot.id)],
            status: "approved",
            data: {
              contractVersion: CONTRACT_VERSION,
              draftOnly: true,
              sceneId: result.value.sceneId,
              sourceHash: hash(sourceScene.shots || []),
              patches: result.value.shots,
              attempts: result.value.attempts,
              promptCompositionManifests: result.value.promptCompositionManifests,
            },
          }, run);
          dbHelpers.saveOperatorArtifact(draft);
          dbHelpers.appendOperatorArtifactQA(draft.id, {
            qaAgentId: "qa.production.shot_content_repair",
            status: "passed",
            blocking: false,
            score: 100,
            issues: [],
            nextAction: "commit",
            createdAt: Date.now(),
          });
        }
      } else {
        consecutiveFailures += 1;
        dbHelpers.appendOperatorRunEvent(run.id, {
          type: "qa_failed",
          message: `Shot 内容修复失败：${result.scene.title}；${result.error}`,
          entityIds: [result.scene.id],
          data: {
            issues: result.issues.map((issue) => ({
              shotId: issue.shotId,
              code: issue.code,
              message: issue.message,
              repairInstruction: issue.repairInstruction,
            })),
            promptCompositionManifests: result.promptCompositionManifests,
          },
        });
      }
    }
    console.log(`[shot-repair] completed=${repaired.length}/${scenes.length} failed=${results.filter((item) => item.status === "failed").length}`);
    if (consecutiveFailures >= CIRCUIT_FAILURES) break;
  }
  if (repaired.length !== scenes.length) {
    dbHelpers.patchOperatorRun(run.id, { status: "needs_human_review", qaSummary: { passed: repaired.length, failed: scenes.length - repaired.length, blocked: scenes.length - repaired.length, warnings: 0 } });
    throw new Error(`Shot repair did not converge: ${repaired.length}/${scenes.length} scenes passed. No project content was committed.`);
  }
  if (options.dryRun) {
    dbHelpers.appendOperatorRunEvent(run.id, { type: "qa_passed", message: `只读试跑通过 ${scenes.length} 场；未修改项目内容。`, entityIds: scenes.map((scene) => scene.id) });
    dbHelpers.patchOperatorRun(run.id, { status: "completed", qaSummary: { passed: scenes.length, warnings: 0, failed: 0, blocked: 0 } });
    console.log(JSON.stringify({ status: "dry_run_passed", projectId: project.id, runId: run.id, scenes: scenes.length }, null, 2));
    return;
  }
  const repairedBySceneId = new Map(repaired.map((item) => [item.sceneId, item]));
  const updatedProject: Project = {
    ...project,
    episodes: productionEpisodes.map((episode) => ({
      ...episode,
      scenes: (episode.scenes || []).map((scene) => {
        const result = repairedBySceneId.get(scene.id);
        if (!result) return scene;
        const candidateById = new Map(result.shots.map((shot) => [shot.id, shot]));
        return {
          ...scene,
          shots: (scene.shots || []).map((shot) => {
            const candidate = candidateById.get(shot.id)!;
            const next = { ...shot, visualAction: candidate.visualAction, characterIdsInShot: candidate.characterIdsInShot, propIds: candidate.propIds };
            return { ...next, imagePrompt: rebuiltPrompt(project, next, candidate.visualAction, "image"), videoPrompt: rebuiltPrompt(project, next, candidate.visualAction, "video") };
          }),
        };
      }),
    })) as unknown as Project["episodes"],
  };
  const patches = repaired.flatMap((scene) => scene.shots.map((shot) => ({ sceneId: scene.sceneId, ...shot })));
  const artifact = createOperatorArtifact({
    runId: run.id,
    projectId: project.id,
    kind: "shot_patch",
    targetPath: "episodes.scenes.shots.visualAction",
    entityIds: [project.id, ...patches.map((patch) => patch.sceneId), ...patches.map((patch) => patch.id)],
    status: "approved",
    data: {
      contractVersion: CONTRACT_VERSION,
      beforeHash: hash(project.episodes),
      afterHash: hash(updatedProject.episodes),
      patches,
      sceneCount: scenes.length,
      shotCount: patches.length,
      promptCompositionManifests: repaired.flatMap((scene) => scene.promptCompositionManifests),
    },
  }, run);
  dbHelpers.saveOperatorArtifact(artifact);
  dbHelpers.appendOperatorArtifactQA(artifact.id, {
    qaAgentId: "qa.production.shot_content_repair",
    status: "passed",
    blocking: false,
    score: 100,
    issues: [],
    nextAction: "commit",
    createdAt: Date.now(),
  });
  dbHelpers.saveProject(updatedProject);
  dbHelpers.appendOperatorRunEvent(run.id, { type: "repair_applied", message: `已提交 ${scenes.length} 场、${patches.length} 个 Shot 的可拍内容修复。`, entityIds: [project.id, ...scenes.map((scene) => scene.id)] });
  dbHelpers.patchOperatorRun(run.id, { status: "completed", qaSummary: { passed: scenes.length, warnings: 0, failed: 0, blocked: 0 }, outputs: [{ kind: "shot_patch", targetPath: artifact.targetPath, entityIds: artifact.entityIds, artifactId: artifact.id }] });
  console.log(JSON.stringify({ status: "completed", projectId: project.id, runId: run.id, scenes: scenes.length, shots: patches.length, maxAttemptsPerScene: MAX_ATTEMPTS }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
