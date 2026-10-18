import assert from "node:assert/strict";
import { useProjectStore } from "../src/store/useProjectStore";
import {
  applyStageExecutionResult,
  approveCurrentStage,
  createProductionRun,
  failCurrentStage,
  getCurrentStage,
  requestRevisionForCurrentStage,
  rerunFromStage,
  retryCurrentStage,
  retryCurrentStageWithDifferentModel,
  runContractQAForCurrentStage,
  skipCurrentStage,
  continueAfterManualEdit,
} from "../src/services/production/orchestrator";
import { executeProductionStage, PromptApprovalRequiredError } from "../src/services/production/runners";
import { loadProductionPromptTemplate } from "../src/services/production/templateLoader";
import { applyStageAgentGateway } from "../src/services/production/stageGatewayBridge";
import { applyLegacyProductionRunInvalidation } from "../src/services/production/legacyProductionRunInvalidation";
import { buildVideoStoryboardAssetBoardPlan } from "../src/services/production/videoStoryboardAssetBoards";

async function executeProductionStageWithAutoApprove(run: any, stage: any) {
  try {
    return await executeProductionStage(run, stage);
  } catch (err: any) {
    if (err instanceof PromptApprovalRequiredError || err.name === "PromptApprovalRequiredError") {
      console.log(`[Test Helper] Auto-approving prompt review for stage: "${stage.stageType}"`);
      stage.promptReview = {
        ...err.promptReview,
        status: "approved",
        approvedAt: Date.now(),
      };
      return await executeProductionStage(run, stage);
    }
    throw err;
  }
}
import { createHttpProductionRunRepository } from "../src/services/production/persistence";
import { ProductionRunProjectInput } from "../src/types/production";
import { Project } from "../src/types/project";
import {
  failedSaveKey,
  recoverFailedProjectSave,
  writeFailedSavePayload,
} from "../src/utils/saveFailureRecovery";

// ----------------------------------------------------
// 0. Mock Browser Globals for Node.js Compatibility
// ----------------------------------------------------
const mockLocalStorage: Record<string, string> = {};
global.localStorage = {
  getItem: (key: string) => mockLocalStorage[key] || null,
  setItem: (key: string, value: string) => { mockLocalStorage[key] = value; },
  removeItem: (key: string) => { delete mockLocalStorage[key]; },
  clear: () => { for (const k in mockLocalStorage) delete mockLocalStorage[k]; },
  length: 0,
  key: (index: number) => Object.keys(mockLocalStorage)[index] || null,
} as any;

// ----------------------------------------------------
// 1. Mock DB and Fetch REST APIs
// ----------------------------------------------------
const projectsDb = new Map<string, any>();
const episodesDb = new Map<string, any>();
const productionRunsDb = new Map<string, any>();

global.fetch = async (url: string, init?: any): Promise<any> => {
  const parsedUrl = new URL(url, "http://localhost");
  const path = parsedUrl.pathname;

  // Handle Base64 file upload mocks
  if (path === "/api/assets/upload") {
    return {
      ok: true,
      json: async () => ({ url: "/media/mock-image.png" }),
    };
  }

  if (path === "/api/production-runs") {
    if ((init?.method || "GET") === "GET") {
      const projectId = parsedUrl.searchParams.get("projectId");
      const runs = Array.from(productionRunsDb.values())
        .filter((run) => !projectId || run.projectId === projectId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return {
        ok: true,
        json: async () => runs,
      };
    }
  }

  if (path.startsWith("/api/production-runs/")) {
    const runId = decodeURIComponent(path.split("/")[3]);
    if ((init?.method || "GET") === "GET") {
      const run = productionRunsDb.get(runId);
      return {
        ok: Boolean(run),
        status: run ? 200 : 404,
        json: async () => run || { error: "Production run not found" },
      };
    }
    if (init?.method === "PUT") {
      const run = JSON.parse(init.body);
      run.id = runId;
      const existing = productionRunsDb.get(runId);
      const incomingRevision = Number(run.revision || 0);
      const baseRevision = Number(init?.headers?.["X-Production-Run-Base-Revision"] || init?.headers?.["x-production-run-base-revision"] || Math.max(0, incomingRevision - 1));
      if (existing && Number(existing.revision || 0) > baseRevision && JSON.stringify(existing) !== JSON.stringify(run)) {
        return {
          ok: false,
          status: 409,
          text: async () => JSON.stringify({ error: "Production run save conflict", serverRun: existing }),
          json: async () => ({ error: "Production run save conflict", serverRun: existing }),
        };
      }
      productionRunsDb.set(runId, run);
      return {
        ok: true,
        json: async () => run,
      };
    }
    if (init?.method === "DELETE") {
      productionRunsDb.delete(runId);
      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    }
  }

  if (path.startsWith("/api/projects/")) {
    const parts = path.split("/");
    const projectId = parts[3]; // /api/projects/:projectId
    const subRoute = parts[4]; // episodes or undefined
    const episodeId = parts[5]; // :episodeId or undefined

    if (subRoute === "episodes" && episodeId) {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body);
        episodesDb.set(episodeId, body);
        return { ok: true, json: async () => body };
      }
      if (init?.method === "GET" || !init) {
        const ep = episodesDb.get(episodeId);
        if (ep) {
          return { ok: true, json: async () => ep };
        }
        // Return a mock default episode to keep tests stable
        const mockEp = { id: episodeId, title: "Mock Episode", scenes: [] };
        episodesDb.set(episodeId, mockEp);
        return { ok: true, json: async () => mockEp };
      }
    } else if (!subRoute) {
      if (init?.method === "PATCH") {
        const body = JSON.parse(init.body);
        const existing = projectsDb.get(projectId) || {};
        const updated = { ...existing, ...body };
        projectsDb.set(projectId, updated);
        return { ok: true, json: async () => updated };
      }
      if (init?.method === "GET" || !init) {
        const proj = projectsDb.get(projectId);
        if (proj) {
          return { ok: true, json: async () => proj };
        }
        return { ok: false, status: 404 };
      }
    }
  }

  return { ok: true, json: async () => ({}) };
};

// ----------------------------------------------------
// 2. Mock LLM (generateAIContent)
// ----------------------------------------------------
let mockFailTrigger = false;
let mockEmptyPromptGeneration = false;
let lastMockPrompt = "";

const extractShotIdsFromPrompt = (prompt: string) => {
  const inputSection = prompt.split("严格返回 JSON")[0] || prompt;
  const ids = Array.from(inputSection.matchAll(/"id"\s*:\s*"([^"]+)"/g))
    .map((match) => match[1])
    .filter((id) => id && id !== "shot id");
  return Array.from(new Set(ids));
};

const containsCjk = (value: string) => /[\u3400-\u9fff]/.test(value || "");

type MockAIOptions = {
  prompt: string;
  schema?: {
    required?: string[];
  };
};

const requiresJsonFields = (options: MockAIOptions, fields: string[]) => {
  const required = options.schema?.required || [];
  return fields.every((field) => required.includes(field));
};

(global as any).__mockAIResponse = async (options: MockAIOptions): Promise<string> => {
  const prompt = options.prompt;
  lastMockPrompt = prompt;
  console.log(`[LLM Call] Prompt contains: "${prompt.substring(0, 100).replace(/\n/g, " ")}..."`);

  if (mockFailTrigger) {
    throw new Error("Simulated LLM API failure");
  }

  if (prompt.includes("创意总监和系统设计师") || prompt.includes("定义可玩性承诺")) {
    return JSON.stringify({
      logline: "在自动制片系统统治的世界里，一个老导演寻找最后一卷胶片的故事。",
      coreConflict: "老导演躲避AI Orion-9的审查，试图放映胶片，面临着胶片被毁的失败代价。",
      interactiveContract: "玩家扮演老导演，通过选择与危机应变，维护对物理胶片的信念。选择、等待与超时默认流为被捕获。",
      worldBuildingRules: [
        { category: "社会规则", content: "AI拥有影视制作的完全审查与决定权。" },
        { category: "科技背景", content: "胶片属于违禁物品，已被物理和数字销毁。" }
      ],
      plannedCharacters: [
        { name: "李导演", roleType: "lead", brief: "70岁的故事讲述者，胶片时代的最后守护者。" },
        { name: "Orion-9", roleType: "supporting", brief: "判定故事商业价值的制片人AI决策实体。" }
      ],
      plannedLocations: [
        { name: "废弃胶片仓库", brief: "堆满灰尘，深埋在霓虹都市地下的秘密基地。" }
      ],
      plannedProps: [
        { name: "最后一卷35mm胶片", brief: "生锈的铁盒里装着人类最后一部纯手作胶片。" }
      ]
    });
  }

  if (prompt.includes("节点场景编剧") || prompt.includes("单个互动节点")) {
    return JSON.stringify({
      script: "李导演手在颤抖。屏幕上闪烁着警报，Orion-9 的投影正在凝聚。\n（互动待机：请做出选择，等待玩家抉择）",
      breakdown: {
        setting: "INT.",
        location: "废弃胶片仓库",
        time: "NIGHT",
        characters: [{ name: "李导演", state: "紧张" }],
        props: [{ name: "最后一卷35mm胶片", state: "带回" }],
        vfx: ["警报光影"],
        sfx: ["警报嗡鸣"],
        wardrobe: [],
        makeupHair: []
      },
      blocks: [
        { type: "scene_heading", content: "INT. 废弃胶片仓库 - NIGHT" },
        { type: "action", content: "李导演把手伸入防潮箱中，手指触碰到冰冷而坚硬的铁盒。等待玩家抉择。" },
        { type: "action", content: "[互动待机] 为UI选项留出安全区空间。" },
        { type: "character", content: "李导演" },
        { type: "dialogue", content: "我就知道……他们没有全烧光。故事还在。" }
      ]
    });
  }

  if (prompt.includes("导演、摄影指导和提示词工程师")) {
    return JSON.stringify({
      shots: [
        {
          shotSize: "CU",
          cameraAngle: "LOW",
          cameraMovement: "PAN",
          visualAction: "李导演指尖触碰斑驳的胶片铁罐罐身，为右侧UI选项预留空白安全区空间",
          lightingAtmo: "Rim light from low blue light source",
          duration: 4,
          motivation: "interactive hold",
          microExpression: "李导演静默呼吸微动循环",
          imagePrompt: "电影感特写，低角度，老导演的手指触碰斑驳胶片铁罐，细微呼吸循环，右侧保留互动 UI 安全区",
          videoPrompt: "镜头缓慢横移掠过老导演触碰生锈胶片铁罐的双手，细微呼吸动作循环，右侧保留互动 UI 安全区",
          imageUrl: "/media/mock-image.png",
          videoUrl: "/media/mock-video.mp4"
        }
      ]
    });
  }

  if (prompt.includes("电影开发制片人") || prompt.includes("立项概念")) {
    return JSON.stringify({
      logline: "在自动制片系统统治的世界里，一个老导演寻找最后一卷胶片的故事。",
      coreConflict: "老导演渴望用胶片记录真实，但AI制片 system判定胶片没有商业价值并对其发起全面销毁。",
      creativeVision: {
        genre: ["Sci-Fi", "Drama"],
        visualStyle: "Cyberpunk Film Noir with high-contrast neon lighting",
        narrativeStyle: "Slow-burn detective thriller with voiceover",
        referenceWorks: "Blade Runner (1982) meets Cinema Paradiso",
        want: "李导演必须找到并公开放映最后一卷35mm胶片",
        need: "他需要承认记忆的价值不只存在于旧媒介，也存在于被他影响的人",
        stakes: "如果失败，最后一份未经算法改写的人类影像记忆会被永久销毁",
        oppositionForce: "Orion-9 代表的自动制片审计系统追捕并封锁所有胶片设备",
        themeQuestion: "当效率可以替代创作时，人类还需要保留笨拙的记忆吗",
        protagonistArc: "从执拗守旧的孤独守护者，走向愿意把胶片交给下一代共同放映的人",
        emotionalReward: "观众获得对手作影像、记忆传承和创作尊严的酸楚释放"
      }
    });
  }

  if (prompt.includes("影视结构总编剧") || prompt.includes("结构方案")) {
    return JSON.stringify({
      options: [
        {
          optionId: "option-1",
          optionDescription: "三段式试制结构",
          episodes: [
            { title: "第一幕：地下仓库", inspiration: "李导演发现最后一卷胶片，并意识到 Orion-9 正在追踪。", targetDuration: 30 },
            { title: "第二幕：旧友背叛", inspiration: "李导演寻找旧友修复放映机，却发现信任关系被 AI 诱导破裂。", targetDuration: 40 },
            { title: "第三幕：屋顶放映", inspiration: "李导演在天台完成秘密放映，必须付出公开身份的代价。", targetDuration: 30 }
          ]
        }
      ]
    });
  }

  if (prompt.includes("影视项目圣经总设计师")) {
    return JSON.stringify({
      worldBuildingRules: [
        { category: "社会规则", content: "AI拥有影视制作的完全审查与决定权。" },
        { category: "科技背景", content: "胶片属于违禁物品，已被物理和数字销毁。" }
      ],
      plannedCharacters: [
        { name: "李导演", roleType: "lead", brief: "70岁的故事讲述者，胶片时代的最后守护者。" },
        { name: "Orion-9", roleType: "supporting", brief: "判定故事商业价值的制片人AI决策实体。" }
      ],
      plannedLocations: [
        { name: "废弃胶片仓库", brief: "堆满灰尘，深埋在霓虹都市地下的秘密基地。" }
      ],
      plannedProps: [
        { name: "最后一卷35mm胶片", brief: "生锈的铁盒里装着人类最后一部纯手作胶片。" }
      ]
    });
  }

  if (prompt.includes("选角导演") || prompt.includes("制作设计师")) {
    return JSON.stringify({
      characters: [
        {
          name: "李导演",
          psychologicalProfile: "执着、怀旧、内心焦虑但外表坚毅",
          actingStyle: "Method acting with silent gestures",
          multiViewPrompt: "老年男性电影导演，多视角角色设定图，风霜感皮肤，旧帆布外套，皱纹清晰，概念设计肖像"
        },
        {
          name: "Orion-9",
          psychologicalProfile: "冷酷、功利、完全没有情感的逻辑实体",
          actingStyle: "Static, holographic projection",
          multiViewPrompt: "蓝色全息界面圆柱体，多视角角色设定图，复杂漂浮节点，极简科幻几何形态"
        }
      ],
      assets: [
        {
          type: "location",
          name: "废弃胶片仓库",
          description: "漏水的管道、霓虹光漏进阴暗的暗房，堆满防潮箱的秘密温床",
          prompt: "阴暗潮湿的地下胶片仓库，管道滴水，青色和红色霓虹漏光，货架上堆满旧电影胶片卷"
        },
        {
          type: "prop",
          name: "最后一卷35mm胶片",
          description: "生锈斑驳的圆形铁盒，表面贴着手写的斑驳标签",
          prompt: "生锈斑驳的金属胶片罐，近景细节，灰尘和划痕清晰，表面有 35mm 手写标签"
        }
      ]
    });
  }

  if (prompt.includes("generateEpisodes") || prompt.includes("电影段落")) {
    return JSON.stringify({
      options: [
        {
          optionId: "opt-1",
          optionDescription: "经典三幕戏剧结构",
          episodes: [
            {
              title: "第一幕：废墟中的火花",
              description: "李导演在废弃的胶片仓库里找到了最后一卷完好的胶片，并惊动了Orion-9的审计实体。",
              targetDuration: 10
            },
            {
              title: "第二幕：霓虹追捕",
              description: "李导演带着胶片穿行在雨夜都市，试图寻找能够播放胶片的废旧放映机。",
              targetDuration: 15
            },
            {
              title: "第三幕：最后的光影",
              description: "李导演成功在大厦楼顶放映了最后一卷胶片，Orion-9在光影洗礼下发生异常卡顿，老导演安静地坐下。",
              targetDuration: 10
            }
          ]
        }
      ]
    });
  }

  if (prompt.includes("场景拆分") || prompt.includes("拆成可拍摄场景")) {
    return JSON.stringify({
      scenes: [
        {
          title: "暗室的回光",
          description: "李导演在仓库最深处打开保险箱，用颤抖的手取出最后一卷35mm胶片。",
          valueCharge: "positive",
          valueShift: {
            from: "李导演只剩传闻和失败记忆",
            to: "他获得真实胶片和行动理由",
            reason: "保险箱被打开，胶片从传说变成可被争夺的实体"
          },
          sceneGoal: "找到胶片",
          sceneAssets: "李导演, 废弃胶片仓库, 最后一卷35mm胶片",
          environment: "INT.",
          timeOfDay: "NIGHT",
          targetDuration: 3,
          hook: "铁盒上覆盖的黄沙散开，露出斑驳字样",
          cliffhanger: "警报红光照亮铁盒编号，Orion-9 已锁定仓库"
        }
      ]
    });
  }

  if (requiresJsonFields(options, ["breakdown", "blocks"])) {
    return JSON.stringify({
      breakdown: {
        setting: "INT.",
        location: { name: "废弃胶片仓库", state: "阴暗潮湿" },
        time: "NIGHT",
        characters: [{ name: "李导演", state: "疲惫但狂热" }],
        props: [{ name: "最后一卷35mm胶片", state: "完好无损" }],
        vfx: ["闪烁的警报红光"],
        sfx: ["放映机马达的空转声"],
        wardrobe: ["破旧帆布大衣"],
        makeupHair: ["斑白蓬乱的头发"]
      },
      blocks: [
        { type: "scene_heading", content: "INT. 废弃胶片仓库 - NIGHT" },
        { type: "action", content: "李导演把手伸入防潮箱中，手指触碰到冰冷而坚硬的铁盒。", camera: "特写：李导演颤抖的指尖" },
        { type: "character", content: "李导演" },
        { type: "dialogue", content: "我就知道……他们没有全烧光。故事还在。" }
      ]
    });
  }

  if (prompt.includes("分镜师") || prompt.includes("导演、摄影指导")) {
    return JSON.stringify({
      shots: [
        {
          shotSize: "CU",
          cameraAngle: "LOW",
          cameraMovement: "PAN",
          visualAction: "李导演指尖触碰斑驳的胶片铁罐罐身",
          lightingAtmo: "Rim light from low blue light source",
          duration: 4,
          motivation: "建立主角与目标物命运牵绊",
          microExpression: "李导演紧锁的眉头微微舒展，眼神中透露出一丝狂热的希望"
        }
      ]
    });
  }

  if (prompt.includes("提示词工程师")) {
    if (mockEmptyPromptGeneration) {
      return JSON.stringify({ prompts: [] });
    }
    const shotIds = extractShotIdsFromPrompt(prompt);
    return JSON.stringify({
      prompts: (shotIds.length > 0 ? shotIds : ["shot-start"]).map((id, index) => ({
        id,
        imagePrompt: `电影感特写 ${index + 1}，低角度，老导演的双手触碰生锈圆形胶片罐，青色霓虹轮廓光，尘埃漂浮在主光中，赛博黑色电影质感`,
        videoPrompt: `缓慢横移镜头 ${index + 1}，掠过触碰生锈胶片罐的双手，细小尘埃在蓝色霓虹主光中漂浮，赛博黑色电影运动感`
      }))
    });
  }

  if (prompt.includes("总架构师") || prompt.includes("Game Blueprint")) {
    return JSON.stringify({
      blueprint: "一个多结局互动悬疑影游蓝图。玩家扮演李导演，在躲避AI审查的过程中选择放映或交出胶片。",
      goldenPath: ["发现胶片", "寻求旧友破译", "顶楼秘密放映"],
      branchingPrinciples: ["基于信任值决定是否出卖胶片", "收集变量决定生存结局"],
      variables: [
        { name: "trust", type: "number", defaultValue: 0 },
        { name: "hasKey", type: "boolean", defaultValue: false }
      ],
      endings: [
        { name: "最后的光影", condition: "trust >= 1 && hasKey === true" },
        { name: "数字尘埃", condition: "trust < 0" }
      ]
    });
  }

  if (prompt.includes("图谱设计师") || prompt.includes("节点图谱")) {
    return JSON.stringify({
      variables: [
        { id: "var-trust", name: "trust", type: "number", defaultValue: 0 },
        { id: "var-hasKey", name: "hasKey", type: "boolean", defaultValue: false }
      ],
      nodes: [
        {
          id: "start",
          title: "暗房秘密抉择",
          scriptContent: "李导演在暗房被Orion-9包围。玩家必须选择交出铁盒或逃往天台。",
          onEnterActions: [],
          isEnding: false,
          uiLayout: "standard"
        },
        {
          id: "help",
          title: "寻求接头人协助",
          scriptContent: "李导演选择逃跑并打给老放映员协助破译保险锁。",
          onEnterActions: [{ targetVariableId: "trust", operation: "set", value: 1 }, { targetVariableId: "hasKey", operation: "set", value: true }],
          isEnding: false,
          uiLayout: "standard"
        },
        {
          id: "leave",
          title: "妥协交出胶片",
          scriptContent: "李导演妥协将铁盒移交给Orion-9换取生存安置。",
          onEnterActions: [{ targetVariableId: "trust", operation: "set", value: -1 }],
          isEnding: true,
          uiLayout: "standard"
        },
        {
          id: "chapter-two-gate",
          title: "通往二层天台门",
          scriptContent: "老放映员提供放映机钥匙，开启天台防线放映机。",
          onEnterActions: [],
          isEnding: true,
          uiLayout: "standard"
        }
      ],
      edges: [
        {
          id: "choice-run",
          sourceNodeId: "start",
          targetNodeId: "help",
          displayText: "誓死带走铁盒并逃跑",
          conditionExpression: ""
        },
        {
          id: "choice-give",
          sourceNodeId: "start",
          targetNodeId: "leave",
          displayText: "向Orion-9妥协移交",
          conditionExpression: ""
        },
        {
          id: "choice-go-gate",
          sourceNodeId: "help",
          targetNodeId: "chapter-two-gate",
          displayText: "用钥匙开启天台控制柜",
          conditionExpression: "trust >= 1"
        }
      ]
    });
  }

  return JSON.stringify({});
};

// ----------------------------------------------------
// 3. Test Runner Infrastructure Helper
// ----------------------------------------------------
async function runStagePipeline(projectInput: ProductionRunProjectInput, policyOverrides = {}) {
  const projectStore = useProjectStore.getState();

  // Reset store to a clean mock state
  projectStore.currentProject = {
    ...projectInput,
    characters: [],
    assets: [],
    episodes: [],
  } as Project;

  let run = createProductionRun(projectStore.currentProject, { policy: policyOverrides });

  if (run.status === "draft") {
    run.status = "running";
    if (run.stages[0].status === "pending") {
      run.stages[0].status = "running";
    }
  }

  while (run.status === "running" || run.status === "needs_human_review") {
    if (run.status === "needs_human_review") {
      console.log(`[Orchestrator] Run is in needs_human_review. Approving current stage: "${getCurrentStage(run).stageType}"`);
      run = approveCurrentStage(run);
      // Wait for debounced state updates to save to the database mock
      await new Promise(resolve => setTimeout(resolve, 600));
      if (run.status === "completed") break;
    }

    const stage = getCurrentStage(run);
    console.log(`[Orchestrator] Running Contract QA for stage: "${stage.stageType}"`);
    run = runContractQAForCurrentStage(run);

    const activeStage = getCurrentStage(run);
    if (activeStage.status === "failed") {
      throw new Error(`QA blocking validation failed on stage: ${activeStage.stageType}`);
    }

    try {
      console.log(`[Orchestrator] Executing production stage: "${activeStage.stageType}"`);
      let result = await executeProductionStageWithAutoApprove(run, activeStage);
      result = await applyStageAgentGateway(run, activeStage, result);
      console.log(`[Orchestrator] Execution finished for stage: "${activeStage.stageType}". Result summary: "${result.summary}"`);
      run = applyStageExecutionResult(run, result);
      console.log(`[Orchestrator] Applied result. New run status: "${run.status}"`);
      if (run.status === "failed") {
        const failedStage = getCurrentStage(run);
        console.log("[Orchestrator] Failed stage QA reports:", JSON.stringify(failedStage.qaReports, null, 2));
      }
      // Wait for debounced state updates to save to the database mock
      await new Promise(resolve => setTimeout(resolve, 600));
    } catch (err: any) {
      console.error(`[Orchestrator] Execution thrown exception on stage "${activeStage.stageType}":`, err.message);
      run = failCurrentStage(run, err.message, "model");
      break;
    }
  }

  return run;
}

// ----------------------------------------------------
// 4. Test Suite Execution
// ----------------------------------------------------
async function testProductionRunHttpPersistence() {
  console.log("▶ [Test 0] Running Production Run HTTP Persistence Test...");
  productionRunsDb.clear();
  const repository = createHttpProductionRunRepository();
  const run = createProductionRun({
    id: "persist-project",
    title: "生产任务持久化测试项目",
    projectModel: "linear",
    type: "movie",
    originalInspiration: "一个需要刷新后仍能恢复生产记录的项目。",
    universalSkillRefs: [],
  });

  const saved = await repository.upsertRun(run);
  assert.equal(saved.id, run.id);
  assert.equal(productionRunsDb.get(run.id).stages.length, run.stages.length);
  assert.equal(productionRunsDb.get(run.id).checkpoints.length, run.checkpoints.length);

  const listed = await repository.listRuns("persist-project");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].projectId, "persist-project");

  const loaded = await repository.getRun(run.id);
  assert.ok(loaded);
  assert.equal(loaded?.artifacts.length, 0);

  await repository.deleteRun(run.id);
  assert.equal(await repository.getRun(run.id), null);
  console.log("✔ [Test 0] Production Run HTTP Persistence Test PASSED.");
}

async function testProductionRunRevisionConflict() {
  console.log("▶ [Test 0a] Running Production Run Revision Conflict Test...");
  productionRunsDb.clear();
  const repository = createHttpProductionRunRepository();
  const baseRun = createProductionRun({
    id: "revision-conflict-project",
    title: "生产任务冲突测试项目",
    projectModel: "linear",
    type: "movie",
    originalInspiration: "两个窗口同时保存同一生产任务。",
    universalSkillRefs: [],
  });
  await repository.upsertRun(baseRun);
  const firstClient = { ...baseRun, name: "First Client Update", revision: 1, updatedAt: Date.now() + 1 };
  await repository.upsertRun(firstClient);
  const secondClient = { ...baseRun, name: "Second Client Update", revision: 1, updatedAt: Date.now() + 2 };
  await assert.rejects(() => repository.upsertRun(secondClient), /conflict/i);
  assert.equal(productionRunsDb.get(baseRun.id).name, "First Client Update");
  console.log("✔ [Test 0a] Production Run Revision Conflict Test PASSED.");
}

async function testProductionTemplateVariableContract() {
  console.log("▶ [Test 0c] Running Production Template Variable Contract Test...");
  localStorage.setItem("omni-prompt-storage", JSON.stringify({
    state: {
      templates: {
        generateEpisodes: {
          id: "generateEpisodes",
          name: "Broken Custom Structure Template",
          template: "BROKEN TEMPLATE WITHOUT REQUIRED VARIABLES",
        },
      },
    },
  }));
  try {
    const loaded = await loadProductionPromptTemplate("generateEpisodes");
    assert.equal(loaded.trace.source, "config.defaultTemplates");
    assert.ok(loaded.trace.metadataWarnings?.some((warning) => warning.includes("已忽略")));
    assert.ok(loaded.trace.metadataWarnings?.some((warning) => warning.includes("{{selectedContext}}")));
    assert.ok(!loaded.template.includes("BROKEN TEMPLATE"));
  } finally {
    localStorage.removeItem("omni-prompt-storage");
  }
  console.log("✔ [Test 0c] Production Template Variable Contract Test PASSED.");
}

async function testFailedSaveRecoveryQueue() {
  console.log("▶ [Test 0b] Running Failed Save Recovery Queue Test...");
  projectsDb.clear();
  episodesDb.clear();
  localStorage.removeItem(failedSaveKey("recover-project"));

  const queuedProject = {
    id: "recover-project",
    title: "排队中的本地标题",
    type: "movie",
    projectModel: "linear",
    aspectRatio: "16:9",
    logline: "本地失败保存里的 logline",
    coreConflict: "本地失败保存里的冲突",
    characters: [{ id: "queued-char", name: "Queued", internalDesire: "保存", externalGoal: "恢复", flaw: "离线" }],
    episodes: [{ id: "queued-episode", title: "本地分集", inspiration: "离线写入" }],
    assets: [],
  } as any as Project;
  const currentProject = {
    ...queuedProject,
    title: "当前内存中的新标题",
    characters: [{ id: "current-char", name: "Current", internalDesire: "继续", externalGoal: "不要被旧队列覆盖", flaw: "竞争写入" }],
    episodes: [{ id: "current-episode", title: "当前分集", inspiration: "后续编辑" }],
  } as any as Project;

  writeFailedSavePayload("recover-project", {
    projectData: queuedProject,
    episodesToSave: [{ id: "queued-episode", title: "本地完整分集", inspiration: "离线写入", scenes: [] } as any],
    timestamp: Date.now(),
  });
  const currentWins = await recoverFailedProjectSave("recover-project", currentProject, {
    currentEpisodes: [{ id: "current-episode", title: "当前完整分集", inspiration: "后续编辑", scenes: [] } as any],
    preferQueuedProjectData: false,
    preferQueuedEpisodes: false,
  });
  assert.equal(currentWins.recovered, true);
  assert.equal(projectsDb.get("recover-project").title, "当前内存中的新标题");
  assert.ok(projectsDb.get("recover-project").characters.some((character: any) => character.id === "current-char"));
  assert.equal(episodesDb.get("current-episode").title, "当前完整分集");
  assert.equal(localStorage.getItem(failedSaveKey("recover-project")), null);

  writeFailedSavePayload("recover-project", {
    projectData: queuedProject,
    episodesToSave: [{ id: "queued-episode", title: "本地完整分集", inspiration: "离线写入", scenes: [] } as any],
    timestamp: Date.now(),
  });
  const queuedWinsOnLoad = await recoverFailedProjectSave("recover-project", currentProject, {
    preferQueuedProjectData: true,
    preferQueuedEpisodes: true,
  });
  assert.equal(queuedWinsOnLoad.recovered, true);
  assert.equal(projectsDb.get("recover-project").title, "排队中的本地标题");
  assert.ok(projectsDb.get("recover-project").characters.some((character: any) => character.id === "queued-char"));
  assert.equal(episodesDb.get("queued-episode").title, "本地完整分集");
  assert.equal(localStorage.getItem(failedSaveKey("recover-project")), null);

  console.log("✔ [Test 0b] Failed Save Recovery Queue Test PASSED.");
}

async function testLinearMovieFullFlow() {
  console.log("▶ [Test 1] Running Linear Movie Full Flow Integration Test...");
  mockFailTrigger = false;

  const projectInput: ProductionRunProjectInput = {
    id: "linear-test-project",
    title: "线性影视全流程测试项目",
    projectModel: "linear",
    type: "movie",
    originalInspiration: "老导演与AI制片人争夺最后一卷胶片的故事。",
    universalSkillRefs: [],
  };

  const finalRun = await runStagePipeline(projectInput);

  console.log("[Test 1] Pipeline run status:", finalRun.status);
  console.log("[Test 1] Active stage states:", finalRun.stages.map(s => `${s.stageType}:${s.status}`));

  const finalProject = useProjectStore.getState().currentProject;
  assert.ok(finalProject);

  assert.equal(finalRun.status, "completed");
  assert.equal(finalRun.stages.every(s => s.status === "completed" || s.status === "skipped"), true);
  const assetBoardPlan = buildVideoStoryboardAssetBoardPlan(finalProject);
  const identityBoards = [
    ...assetBoardPlan.characterBoards,
    ...assetBoardPlan.sceneBoards,
    ...assetBoardPlan.propBoards,
    ...assetBoardPlan.variantBoards,
  ];
  const boardsMissingChineseProductionPrompt = identityBoards
    .filter((board) => !board.prompt || !containsCjk(board.prompt))
    .map((board) => ({ id: board.id, assetName: board.assetName, boardKind: board.boardKind }));
  assert.deepEqual(boardsMissingChineseProductionPrompt, []);
  const promptStage = finalRun.stages.find(s => s.stageType === "prompt");
  assert.equal(promptStage?.promptUsed?.includes("[ContextPlan 注入]"), false);
  assert.ok((promptStage?.contextUsed as any)?.contextTrace?.fieldScope?.includes("fieldLanguagePolicy"));
  assert.equal((promptStage?.contextUsed as any)?.agentGateway?.workflowStepId, "autostudio.stage.prompt");
  assert.ok(promptStage?.qaReports.some((report: any) => report.checkerId === "linear.prompt.image_compiler.qa"));
  assert.ok(promptStage?.qaReports.some((report: any) => report.checkerId === "linear.prompt.video_compiler.qa"));
  assert.ok(promptStage?.qaReports.some((report: any) => report.checkerId === "qa.linear.media_provenance"));
  assert.ok(promptStage?.qaReports.some((report: any) => report.checkerId === "qa.contract.stage.prompt"));
  const conceptStage = finalRun.stages.find(s => s.stageType === "concept");
  const scriptStage = finalRun.stages.find(s => s.stageType === "script");
  const storyboardStage = finalRun.stages.find(s => s.stageType === "storyboard");
  assert.equal((conceptStage?.contextUsed as any)?.agentGateway?.workflowStepId, "autostudio.stage.concept");
  assert.ok(scriptStage?.qaReports.some((report: any) => report.checkerId === "linear.script.writer.qa"));
  assert.ok(scriptStage?.qaReports.some((report: any) => report.checkerId === "linear.breakdown.extractor.qa"));
  assert.ok(scriptStage?.qaReports.some((report: any) => report.checkerId === "qa.linear.performance_beats"));
  const scriptCheckpoint = finalRun.checkpoints.find((checkpoint) =>
    checkpoint.stageId === scriptStage?.id && checkpoint.kind === "output",
  );
  const scriptSnapshot = scriptCheckpoint?.snapshot as any;
  assert.ok(scriptSnapshot?.performanceBeatDrafts?.performanceBeats?.length > 0);
  assert.ok(storyboardStage?.qaReports.some((report: any) => report.checkerId === "linear.storyboard.shot_planner.qa"));
  assert.ok(storyboardStage?.qaReports.some((report: any) => report.checkerId === "linear.storyboard.continuity_planner.qa"));
  const costStage = finalRun.stages.find(s => s.stageType === "expensive_generation_planning");
  const costCheckpoint = finalRun.checkpoints.find((checkpoint) =>
    checkpoint.stageId === costStage?.id && checkpoint.kind === "output",
  );
  const costSnapshot = costCheckpoint?.snapshot as any;
  assert.ok(costSnapshot);
  assert.equal(costSnapshot.generationQueues.image.count, costSnapshot.imagePromptCount);
  assert.equal(costSnapshot.generationQueues.video.count, costSnapshot.videoPromptCount);
  assert.equal(costSnapshot.generationQueues.videoUnit.count, costSnapshot.videoGenerationUnitCount);
  assert.equal(costSnapshot.generationQueues.audio.count, costSnapshot.audioTrackCount);
  assert.equal(costSnapshot.videoGenerationUnitDrafts.count, costSnapshot.videoGenerationUnitCount);
  assert.equal(costSnapshot.videoGenerationUnitDrafts.unitIds.length, costSnapshot.videoGenerationUnitCount);
  assert.deepEqual(
    costSnapshot.generationQueues.videoUnit.items.map((item: any) => item.videoGenerationUnitId),
    costSnapshot.videoGenerationUnitDrafts.unitIds,
  );
  const videoUnitQa = costStage?.qaReports.find((report: any) => report.checkerId === "qa.linear.video_generation_unit");
  assert.ok(videoUnitQa);
  assert.equal(videoUnitQa.blocking, false);
  assert.equal(costSnapshot.videoGenerationUnitDrafts.blockingIssueCount, 0);
  assert.equal(typeof costSnapshot.estimatedDurationMinutes.total, "number");
  assert.equal(typeof costSnapshot.retryLimit.totalRetries, "number");
  assert.equal(Array.isArray(costSnapshot.skippableItems), true);

  assert.equal(finalProject.logline.includes("老导演"), true);
  assert.equal(finalProject.characters.length, 2);
  assert.equal(finalProject.assets.filter(a => a.type === "location").length, 1);
  assert.equal(finalProject.assets.filter(a => a.type === "prop").length, 1);
  assert.equal(finalProject.episodes.length, 3);

  const testEpisode = episodesDb.get(finalProject.episodes[0].id);
  assert.ok(testEpisode);
  assert.equal(testEpisode.scenes.length, 1);
  assert.ok(testEpisode.scenes[0].scriptBlocks.length > 0);
  assert.ok(testEpisode.scenes[0].breakdown);
  assert.ok(testEpisode.scenes[0].shots.length > 0);
  assert.ok(testEpisode.scenes[0].breakdown.characterIds?.length > 0);
  assert.ok(testEpisode.scenes[0].breakdown.locationId);
  assert.ok(testEpisode.scenes[0].breakdown.propIds?.length > 0);
  assert.equal(testEpisode.scenes[0].shots.every((shot: any) => shot.characterIdsInShot?.length > 0), true);
  assert.equal(testEpisode.scenes[0].shots.every((shot: any) => shot.locationId), true);
  assert.equal(testEpisode.scenes[0].shots.every((shot: any) => shot.propIds?.length > 0), true);
  const generatedEpisodes = finalProject.episodes
    .map((episode: any) => episodesDb.get(episode.id))
    .filter(Boolean);
  const generatedShots = generatedEpisodes.flatMap((episode: any) =>
    episode.scenes.flatMap((scene: any) => scene.shots || []),
  );
  const characterIds = new Set(finalProject.characters.map((character: any) => character.id));
  const locationIds = new Set(finalProject.assets.filter((asset: any) => asset.type === "location").map((asset: any) => asset.id));
  const propIds = new Set(finalProject.assets.filter((asset: any) => asset.type === "prop").map((asset: any) => asset.id));
  assert.ok(generatedShots.length > 0);
  assert.equal(generatedShots.every((shot: any) =>
    (shot.characterIdsInShot || []).length > 0 &&
    shot.characterIdsInShot.every((id: string) => characterIds.has(id)) &&
    Boolean(shot.locationId) &&
    locationIds.has(shot.locationId) &&
    (shot.propIds || []).length > 0 &&
    shot.propIds.every((id: string) => propIds.has(id)),
  ), true);
  assert.equal(testEpisode.scenes[0].shots.every((shot: any) => shot.imagePrompt && shot.videoPrompt), true);
  assert.equal(testEpisode.scenes[0].shots.every((shot: any) => containsCjk(shot.imagePrompt) && containsCjk(shot.videoPrompt)), true);

  console.log("✔ [Test 1] Linear Movie Full Flow Integration Test PASSED.");
}

async function testPromptStageBlocksZeroGeneration() {
  console.log("▶ [Test 1b] Running Prompt Zero Generation Regression Test...");
  mockEmptyPromptGeneration = true;
  try {
    const projectInput: ProductionRunProjectInput = {
      id: "prompt-zero-project",
      title: "Prompt 零产出测试项目",
      projectModel: "linear",
      type: "movie",
      originalInspiration: "一个有分镜但提示词模型返回空数组的项目。",
      universalSkillRefs: [],
    };
    const episodeId = "prompt-zero-episode";
    episodesDb.set(episodeId, {
      id: episodeId,
      title: "Prompt 零产出段落",
      scenes: [
        {
          id: "prompt-zero-scene",
          title: "无提示词镜头",
          description: "一个需要补齐提示词的镜头。",
          shots: [
            {
              id: "prompt-zero-shot",
              shotSize: "CU",
              cameraAngle: "EYE",
              cameraMovement: "STATIC",
              visualAction: "角色看向镜头",
              lightingAtmo: "soft key light",
              duration: 4,
            },
          ],
        },
      ],
    });
    useProjectStore.getState().currentProject = {
      ...projectInput,
      aspectRatio: "16:9",
      logline: "提示词零产出必须阻断。",
      coreConflict: "不能让没有 imagePrompt/videoPrompt 的镜头进入后续媒体生成。",
      creativeVision: { genre: ["Drama"], visualStyle: "Noir", narrativeStyle: "", referenceWorks: "" },
      characters: [],
      assets: [],
      episodes: [{ id: episodeId, title: "Prompt 零产出段落", inspiration: "测试", sceneCount: 1 }],
      globalGenerationParams: { qualityPrompt: "", negativePrompt: "" },
    } as Project;

    const run = createProductionRun(projectInput);
    const promptStage = run.stages.find((stage) => stage.stageType === "prompt");
    assert.ok(promptStage);
    const result = await executeProductionStageWithAutoApprove(run, promptStage);
    assert.equal(result.qaReports[0].blocking, true);
    assert.deepEqual((result.outputSnapshot as any).updatedShotIds, []);
    assert.deepEqual((result.outputSnapshot as any).shotsNeedingPromptIds, ["prompt-zero-shot"]);
  } finally {
    mockEmptyPromptGeneration = false;
  }
  console.log("✔ [Test 1b] Prompt Zero Generation Regression Test PASSED.");
}

async function testProductionPromptApprovalAndEditedPrompt() {
  console.log("▶ [Test 1c] Running Production Prompt Approval Test...");
  const projectInput: ProductionRunProjectInput = {
    id: "production-prompt-approval-project",
    title: "制片提示词审批测试项目",
    projectModel: "linear",
    type: "movie",
    originalInspiration: "一个必须先审批提示词再生成立项概念的影视项目。",
    universalSkillRefs: [],
  };
  useProjectStore.getState().currentProject = {
    ...projectInput,
    aspectRatio: "16:9",
    logline: "",
    coreConflict: "",
    creativeVision: { genre: [], visualStyle: "", narrativeStyle: "", referenceWorks: "" },
    characters: [],
    assets: [],
    episodes: [],
    globalGenerationParams: { qualityPrompt: "", negativePrompt: "" },
  } as Project;

  const run = createProductionRun(projectInput);
  const conceptStage = run.stages.find((stage) => stage.stageType === "concept");
  assert.ok(conceptStage);
  let promptReview: any;
  await assert.rejects(
    async () => executeProductionStage(run, conceptStage),
    (error: any) => {
      promptReview = error.promptReview;
      return error instanceof PromptApprovalRequiredError || error.name === "PromptApprovalRequiredError";
    },
  );
  assert.equal(promptReview.templateId, "template.concept");
  assert.ok(promptReview.originalPrompt.includes(projectInput.title));

  const editedMarker = "EDITED_PRODUCTION_CONCEPT_MARKER";
  const approvedStage = {
    ...conceptStage,
    promptReview: {
      ...promptReview,
      status: "edited" as const,
      editedPrompt: `${promptReview.originalPrompt}\n${editedMarker}`,
      approvedAt: Date.now(),
    },
  };
  const result = await executeProductionStage(run, approvedStage);
  assert.ok(lastMockPrompt.includes(editedMarker));
  assert.ok((result.outputSnapshot as any).logline);
  assert.ok((result.outputSnapshot as any).creativeVision);
  const changedContextStage = {
    ...approvedStage,
    revisionInstructions: "作者更新了当前阶段目标。",
  };
  const changedContextResult = await executeProductionStage(run, changedContextStage);
  assert.ok((changedContextResult.outputSnapshot as any).logline);
  assert.equal(lastMockPrompt.includes(editedMarker), false);
  assert.match(changedContextStage.inputConflictWarning || "", /已保留原批准/);
  console.log("✔ [Test 1c] Production Prompt Approval Test PASSED.");
}

async function testRetiredInteractivePipelineBoundary() {
  console.log("▶ [Test 2] Running Retired Interactive Pipeline Boundary Test...");
  mockFailTrigger = false;

  const projectInput: ProductionRunProjectInput = {
    id: "interactive-test-project",
    title: "互动游戏全流程测试项目",
    projectModel: "interactive",
    type: "movie",
    originalInspiration: "老导演与最后一卷胶片的互动抉择模式。",
    interactiveTemplate: "FMV mystery",
    interactiveConfig: {
      scale: "light",
      targetNodeCount: 4,
      targetEndingCount: 2,
      playDurationMin: 5,
      explorationDurationMin: 5,
    },
    universalSkillRefs: [],
  };

  const project = {
    ...projectInput,
    aspectRatio: "16:9",
    characters: [],
    assets: [],
    episodes: [],
  } as Project;
  useProjectStore.getState().currentProject = project;
  const projectBefore = JSON.stringify(project);
  const promptBefore = lastMockPrompt;
  const run = createProductionRun(projectInput);
  const retiredStageTypes = [
    "interactive_bible",
    "game_blueprint",
    "graph_generation",
    "interactive_graph_qa",
    "node_to_scene",
    "interactive_script",
    "interactive_storyboard",
    "playtest_simulation",
  ];

  for (const stageType of retiredStageTypes) {
    const stage = run.stages.find((item) => item.stageType === stageType);
    assert.ok(stage, `Missing retired interactive stage fixture: ${stageType}`);
    await assert.rejects(
      async () => executeProductionStage(run, stage),
      (error: any) => error instanceof Error
        && error.message.includes(`历史互动自动制片阶段「${stageType}」已停止执行`),
    );
  }

  assert.equal(JSON.stringify(useProjectStore.getState().currentProject), projectBefore);
  assert.equal(projectsDb.has(projectInput.id), false);
  assert.equal(lastMockPrompt, promptBefore);
  console.log("✔ [Test 2] Retired Interactive Pipeline Boundary Test PASSED.");
}

async function testResumeAfterFailure() {
  console.log("▶ [Test 3] Running Resume after Failure Test...");

  const projectInput: ProductionRunProjectInput = {
    id: "failure-resume-project",
    title: "失败续做测试项目",
    projectModel: "linear",
    type: "movie",
    originalInspiration: "一个中途需要经历重试与失败的可恢复项目。",
    universalSkillRefs: [],
  };

  const projectStore = useProjectStore.getState();
  projectStore.currentProject = { ...projectInput, characters: [], assets: [], episodes: [] } as Project;

  let run = createProductionRun(projectStore.currentProject);

  // 1. Advance intake stage successfully
  let stage = getCurrentStage(run);
  let result = await executeProductionStageWithAutoApprove(run, stage);
  run = applyStageExecutionResult(run, result);
  await new Promise(resolve => setTimeout(resolve, 600));

  // 2. Trigger mock fail for concept stage
  mockFailTrigger = true;
  stage = getCurrentStage(run);
  try {
    result = await executeProductionStageWithAutoApprove(run, stage);
    run = applyStageExecutionResult(run, result);
  } catch (err: any) {
    run = failCurrentStage(run, err.message, "model");
  }
  await new Promise(resolve => setTimeout(resolve, 600));

  assert.equal(run.status, "failed");
  assert.equal(getCurrentStage(run).status, "failed");

  // 3. Turn off mock failure and resume run
  mockFailTrigger = false;
  run = retryCurrentStage(run);
  assert.equal(run.status, "running");
  assert.equal(getCurrentStage(run).status, "retrying");
  await new Promise(resolve => setTimeout(resolve, 600));

  // 4. Run the stage again successfully
  stage = getCurrentStage(run);
  result = await executeProductionStageWithAutoApprove(run, stage);
  run = applyStageExecutionResult(run, result);
  await new Promise(resolve => setTimeout(resolve, 600));

  assert.equal(run.status, "needs_human_review");
  assert.equal(getCurrentStage(run).status, "needs_human_review");

  console.log("✔ [Test 3] Resume after Failure Test PASSED.");
}

async function testHumanGatePauseAndResume() {
  console.log("▶ [Test 4] Running Human Gate Pause and Resume Test...");
  mockFailTrigger = false;

  const projectInput: ProductionRunProjectInput = {
    id: "human-gate-project",
    title: "人工确认门禁测试项目",
    projectModel: "linear",
    type: "movie",
    originalInspiration: "一个中途包含审核通过卡点的项目。",
    universalSkillRefs: [],
  };

  const projectStore = useProjectStore.getState();
  projectStore.currentProject = { ...projectInput, characters: [], assets: [], episodes: [] } as Project;

  // Set the manual gates policy explicitly for concept stage
  let run = createProductionRun(projectStore.currentProject, {
    policy: { manualGates: ["concept"] },
  });

  // 1. Intake Stage
  let stage = getCurrentStage(run);
  let result = await executeProductionStageWithAutoApprove(run, stage);
  run = applyStageExecutionResult(run, result);
  await new Promise(resolve => setTimeout(resolve, 600));

  // 2. Concept Stage (Manual review)
  stage = getCurrentStage(run);
  // Flag this stage run as requiring review
  stage.requiresHumanReview = true;

  result = await executeProductionStageWithAutoApprove(run, stage);
  run = applyStageExecutionResult(run, result);
  await new Promise(resolve => setTimeout(resolve, 600));

  // Run status should now be paused in review status
  assert.equal(run.status, "needs_human_review");
  assert.equal(getCurrentStage(run).status, "needs_human_review");

  // 3. User approves the stage
  run = approveCurrentStage(run);
  assert.equal(run.status, "running");
  assert.equal(getCurrentStage(run).stageType, "context_planning");

  console.log("✔ [Test 4] Human Gate Pause and Resume Test PASSED.");
}

async function testResumeAfterManualEdit() {
  console.log("▶ [Test 5] Running Resume after Manual Edit Test...");
  mockFailTrigger = false;

  const projectInput: ProductionRunProjectInput = {
    id: "manual-edit-project",
    title: "人工修改接管测试项目",
    projectModel: "linear",
    type: "movie",
    originalInspiration: "一个在中途可由人类编辑修改并顺利接轨继续制片的项目。",
    universalSkillRefs: [],
  };

  const projectStore = useProjectStore.getState();
  projectStore.currentProject = { ...projectInput, characters: [], assets: [], episodes: [] } as Project;

  let run = createProductionRun(projectStore.currentProject);

  // 1. Advance intake stage
  let stage = getCurrentStage(run);
  let result = await executeProductionStageWithAutoApprove(run, stage);
  run = applyStageExecutionResult(run, result);
  await new Promise(resolve => setTimeout(resolve, 600));

  // 2. Advance concept stage
  stage = getCurrentStage(run);
  result = await executeProductionStageWithAutoApprove(run, stage);
  run = applyStageExecutionResult(run, result);
  await new Promise(resolve => setTimeout(resolve, 600));

  assert.equal(run.status, "needs_human_review");
  run = approveCurrentStage(run);
  await new Promise(resolve => setTimeout(resolve, 600));

  // 3. Perform manual edit on the current project in store
  assert.ok(projectStore.currentProject);
  projectStore.currentProject.logline = "李导演与最后一卷胶片的传奇绝唱。（人工大幅优化版）";

  // 4. Signal manual resume to the orchestrator
  run = continueAfterManualEdit(run, "用户精修了Logline文本结构。");
  await new Promise(resolve => setTimeout(resolve, 600));

  // Run should proceed to the next stage (bible) and remain in running state
  assert.equal(run.status, "running");
  assert.equal(getCurrentStage(run).stageType, "bible");
  assert.equal(run.checkpoints.at(-1)?.kind, "human_review");
  assert.equal((run.checkpoints.at(-1)?.snapshot as { usedManualEdits?: boolean } | undefined)?.usedManualEdits, true);

  console.log("✔ [Test 5] Resume after Manual Edit Test PASSED.");
}

async function testAssetSyncBlocksNewAssets() {
  console.log("▶ [Test 6] Running Asset Sync Reroute Test...");
  const projectInput: ProductionRunProjectInput = {
    id: "asset-sync-reroute-project",
    title: "资产同步回流测试项目",
    projectModel: "linear",
    type: "movie",
    originalInspiration: "剧本 breakdown 临时发现新角色和新道具。",
    refinedInspiration: "",
    universalSkillRefs: [],
  };
  const episodeId = "asset-sync-episode";
  episodesDb.set(episodeId, {
    id: episodeId,
    title: "资产同步测试段落",
    scenes: [
      {
        id: "scene-new-assets",
        title: "新资产出现",
        breakdown: {
          location: { name: "地下剪辑室" },
          characters: [{ name: "新剪辑师" }],
          props: [{ name: "银色剪刀" }],
        },
      },
    ],
  });
  useProjectStore.getState().currentProject = {
    ...projectInput,
    aspectRatio: "16:9",
    logline: "新资产必须回到补档阶段。",
    coreConflict: "生产流程不能跳过新资产补档。",
    characters: [],
    assets: [],
    plannedCharacters: [],
    plannedLocations: [],
    plannedProps: [],
    episodes: [{ id: episodeId, title: "资产同步测试段落", inspiration: "测试", sceneCount: 1 }],
    globalGenerationParams: { qualityPrompt: "", negativePrompt: "" },
  } as Project;

  const run = createProductionRun(projectInput);
  const assetSyncStage = run.stages.find((stage) => stage.stageType === "asset_sync");
  assert.ok(assetSyncStage);
  const result = await executeProductionStageWithAutoApprove(run, assetSyncStage);
  const qa = result.qaReports.find((report) => report.checkerId === "asset.lifecycle.qa");
  assert.equal(qa?.blocking, true);
  assert.ok(qa?.fixInstructions?.includes("asset_detail"));
  assert.equal((result.outputSnapshot as any).requiresAssetDetailRerun, true);

  console.log("✔ [Test 6] Asset Sync Reroute Test PASSED.");
}

async function testAssetOrphanScanner() {
  console.log("▶ [Test 7] Running Asset Orphan Scanner Test...");
  const { scanProjectAssetOrphans } = await import("../src/utils/assetRefs");

  const mockProject = {
    id: "orphan-project",
    title: "Orphan Test",
    projectModel: "linear",
    type: "movie",
    characters: [
      { id: "char-jack", name: "Jack" }
    ],
    assets: [
      { id: "loc-bar", type: "location", name: "Neon Bar" }
    ],
    episodes: []
  } as any;

  const mockEpisode = {
    id: "ep-1",
    scenes: [
      {
        id: "scene-1",
        breakdown: {
          characterIds: ["char-jack", "char-deleted-jill"],
          characters: ["Jack", "Jill"],
          locationId: "loc-bar",
          location: "Neon Bar"
        },
        scriptBlocks: [
          { linkedAssetId: "char-deleted-jill", content: "Jill enters." },
          { linkedAssetId: "char-jack", content: "Jack looks up." }
        ],
        shots: [
          {
            characterIdsInShot: ["char-jack"],
            imagePrompt: "Jack sits in Neon Bar, Jill sits next to him",
            videoPrompt: "Jack talks to Jill"
          }
        ]
      }
    ]
  } as any;

  const result = scanProjectAssetOrphans(mockProject, mockEpisode, [
    { id: "char-deleted-jill", name: "Jill", type: "character" }
  ]);

  assert.ok(result.missingRefs.length > 0);
  const missingRawValues = result.missingRefs.map(m => m.rawValue);
  assert.ok(missingRawValues.includes("char-deleted-jill"));

  assert.ok(result.freeTextOrphans.length > 0);
  const freeTextNames = result.freeTextOrphans.map(f => f.name);
  assert.ok(freeTextNames.includes("Jill"));

  console.log("✔ [Test 7] Asset Orphan Scanner Test PASSED.");
}

async function testAssetChangeMarksProductionRunStale() {
  console.log("▶ [Test 7b] Running Asset Change Production Stale Linkage Test...");
  const projectInput: ProductionRunProjectInput = {
    id: "asset-stale-project",
    title: "资产 stale 联动测试",
    projectModel: "linear",
    type: "movie",
    originalInspiration: "资产删除后旧分镜和提示词必须 stale。",
    universalSkillRefs: [],
  };
  const run = createProductionRun(projectInput);
  const scriptStage = run.stages.find((stage) => stage.stageType === "script");
  assert.ok(scriptStage);
  const completedRun = {
    ...run,
    status: "completed" as const,
    revision: 3,
    stages: run.stages.map((stage) =>
      stage.id === scriptStage.id
        ? {
            ...stage,
            status: "completed" as const,
            outputArtifactIds: ["artifact-script"],
          }
        : stage,
    ),
    artifacts: [
      {
        id: "artifact-script",
        projectId: projectInput.id,
        runId: run.id,
        stageId: scriptStage.id,
        artifactType: "script" as const,
        targetPath: "episode.scenes.scriptBlocks",
        entityIds: ["scene-1"],
        version: 1,
        summary: "旧剧本",
        createdAt: Date.now(),
      },
    ],
  };
  const invalidation = applyLegacyProductionRunInvalidation([completedRun as any], projectInput.id, {
    changeType: "asset_deleted",
    entityId: "char-1",
    entityName: "李导演",
    assetType: "character",
  });
  const updatedRun = invalidation.runs[0];
  const updatedScriptStage = updatedRun.stages.find((stage) => stage.stageType === "script");
  assert.equal(updatedScriptStage?.stale, true);
  assert.equal(updatedRun.artifacts[0].stale, true);
  assert.ok((updatedRun.revision || 0) > 3);
  console.log("✔ [Test 7b] Asset Change Production Stale Linkage Test PASSED.");
}

async function testSaveConflictResolver() {
  console.log("▶ [Test 8] Running Save Conflict Resolver Test...");
  const projectStore = useProjectStore.getState();

  const projectId = "conflict-resolve-project";
  localStorage.removeItem(failedSaveKey(projectId));
  projectsDb.clear();

  const dbVersion = {
    id: projectId,
    title: "Database Version Title",
    projectModel: "linear",
    type: "movie",
    characters: [],
    assets: [],
    episodes: []
  } as any;

  const localVersion = {
    id: projectId,
    title: "Local Queue Version Title",
    projectModel: "linear",
    type: "movie",
    characters: [],
    assets: [],
    episodes: []
  } as any;

  const memoryVersion = {
    id: projectId,
    title: "Memory Version Title",
    projectModel: "linear",
    type: "movie",
    characters: [],
    assets: [],
    episodes: []
  } as any;

  projectsDb.set(projectId, dbVersion);
  projectStore.currentProject = memoryVersion;

  writeFailedSavePayload(projectId, {
    projectData: localVersion,
    episodesToSave: [],
    timestamp: Date.now()
  });

  let resolvedChoice: string | null = null;
  projectStore.showSaveConflict = async (id, db, local, memory) => {
    assert.equal(id, projectId);
    assert.equal(db.title, "Database Version Title");
    assert.equal(local.title, "Local Queue Version Title");
    assert.equal(memory.title, "Memory Version Title");
    resolvedChoice = "local";
    return "local";
  };

  await projectStore.loadProject(projectId);

  assert.equal(resolvedChoice, "local");
  assert.equal(useProjectStore.getState().currentProject?.title, "Local Queue Version Title");
  assert.equal(projectsDb.get(projectId).title, "Local Queue Version Title");
  assert.equal(localStorage.getItem(failedSaveKey(projectId)), null);

  console.log("✔ [Test 8] Save Conflict Resolver Test PASSED.");
}

// ----------------------------------------------------
// 5. Main Execution Wrapper
// ----------------------------------------------------
async function main() {
  try {
    console.log("====================================================");
    console.log("STARTING AUTOMATED PRODUCTION INTEGRATION TEST SUITE");
    console.log("====================================================");

    await testProductionRunHttpPersistence();
    console.log("----------------------------------------------------");
    await testProductionRunRevisionConflict();
    console.log("----------------------------------------------------");
    await testProductionTemplateVariableContract();
    console.log("----------------------------------------------------");
    await testFailedSaveRecoveryQueue();
    console.log("----------------------------------------------------");
    await testLinearMovieFullFlow();
    console.log("----------------------------------------------------");
    await testPromptStageBlocksZeroGeneration();
    console.log("----------------------------------------------------");
    await testProductionPromptApprovalAndEditedPrompt();
    console.log("----------------------------------------------------");
    await testRetiredInteractivePipelineBoundary();
    console.log("----------------------------------------------------");
    await testResumeAfterFailure();
    console.log("----------------------------------------------------");
    await testHumanGatePauseAndResume();
    console.log("----------------------------------------------------");
    await testResumeAfterManualEdit();
    console.log("----------------------------------------------------");
    await testAssetSyncBlocksNewAssets();
    console.log("----------------------------------------------------");
    await testAssetOrphanScanner();
    console.log("----------------------------------------------------");
    await testAssetChangeMarksProductionRunStale();
    console.log("----------------------------------------------------");
    await testSaveConflictResolver();

    console.log("====================================================");
    console.log("ALL AUTO PRODUCTION MODE INTEGRATION TESTS PASSED!");
    console.log("====================================================");
  } catch (error) {
    console.error("❌ TEST SUITE RUN ENCOUNTERED FATAL EXCEPTION:");
    console.error(error);
    process.exit(1);
  }
}

main();
