import { ensureScriptSchema, scriptRepository, scriptRuntime } from "./apps/api/src/repositories/scriptRepository";
import { registerScriptRoutes } from "./apps/api/src/routes/scriptRoutes";
import express from "express";
import { registerManualAIRoutes } from "./src/server/manualAI";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { runMigrationsFromFiles, dbHelpers, ensureDeepMigration } from "./src/server/db";
import {
  readOperatorHandbookFromPath,
  registerOperatorMetadataRoutes,
} from "./src/server/operatorMetadataRoutes";
import { registerAiConfigRoutes } from "./src/server/routes/aiConfigRoutes";
import { registerAssetRoutes } from "./src/server/routes/assetRoutes";
import { registerOperatorArtifactRoutes } from "./src/server/operatorArtifactRoutes";
import { registerOperatorAssetRoutes } from "./src/server/operatorAssetRoutes";
import { registerOperatorCreativeChangeRoutes } from "./src/server/operatorCreativeChangeRoutes";
import { registerOperatorStyleReferenceRoutes } from "./src/server/operatorStyleReferenceRoutes";
import { registerOperatorStoryboardStrategyRoutes } from "./src/server/operatorStoryboardStrategyRoutes";
import { registerOperatorCastingRoutes } from "./src/server/operatorCastingRoutes";
import { registerOperatorProjectContextRoutes } from "./src/server/operatorProjectContextRoutes";
import { registerOperatorProductionCockpitRoutes } from "./src/server/operatorProductionCockpitRoutes";
import { registerOperatorLegacyProductionDraftRoutes } from "./src/server/operatorLegacyProductionDraftRoutes";
import { registerOperatorQARoutes } from "./src/server/operatorQARoutes";
import { registerOperatorRunRoutes } from "./src/server/operatorRunRoutes";
import { registerLegacyProjectRoutes } from "./src/server/routes/legacyProjectRoutes";
import { registerProviderProxyRoutes } from "./src/server/routes/providerProxyRoutes";
import { getProviderKeyStatus, redactProxyText } from "./src/server/routes/providerProxyUtils";
import { registerPromptRoutes } from "./src/server/routes/promptRoutes";
import { registerRuntimeRoutes } from "./src/server/routes/runtimeRoutes";
import { registerSkillRoutes } from "./src/server/routes/skillRoutes";
import { registerSystemRoutes } from "./src/server/routes/systemRoutes";
import { registerVideoAnalysisRoutes } from "./src/server/routes/videoAnalysisRoutes";
import { resolveServerBindHost } from "./src/server/serverBindPolicy";
import { listenWithPortFallback } from "./src/server/listenWithPortFallback";
import { shouldServeSpaDocument } from "./src/server/productionStaticPolicy";
import { registerInteractiveRoutes } from "./src/server/routes/interactiveRoutes";
import { ensureInteractiveSchema } from "./src/server/interactiveRepository";
import { createInteractiveWritingPort } from "./src/server/interactiveWritingPort";
import { createInteractiveProductionPrepPort } from "./src/server/interactiveProductionPrepPort";
import { generateServerGenericAIJson } from "./apps/api/src/providers/genericAIProvider";
import { ensureAssistantSchema } from "./src/server/assistantRepository";
import { registerAssistantRoutes } from "./src/server/assistantRoutes";
import { ProductionPreparationBatchRuntime } from "./src/services/assistant/productionPreparationBatch";
import {
  assertOperatorProjectAllowed,
  assertOperatorTokenAuthorized,
  createOperatorSecurityPolicy,
  extractOperatorTokenFromHeaders,
  OperatorSecurityError,
} from "./src/services/operator/security";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OMNI_BRAINS_DIR = path.join(__dirname, "OMNI_Brains");
const MOVIES_DATA_DIR = path.join(__dirname, "Movies_Data_State");
const MEDIA_ASSETS_DIR = path.join(__dirname, "OMNI_Workspace", "Media_Assets");
const SKILLS_DIR = process.env.OMNI_SKILLS_DIR || path.join(__dirname, "skills");
const OPERATOR_HANDBOOK_PATH = path.join(__dirname, "doc", "design.md");

async function readOperatorHandbook() {
  return readOperatorHandbookFromPath(OPERATOR_HANDBOOK_PATH);
}

function compactRuntimeLogDetails(value: unknown, maxLength = 1000) {
  const raw = typeof value === "string" ? value : JSON.stringify(value || {});
  return redactProxyText(raw, maxLength);
}

async function ensureDirs() {
  try {
    await fs.mkdir(OMNI_BRAINS_DIR, { recursive: true });
    await fs.mkdir(MOVIES_DATA_DIR, { recursive: true });
    await fs.mkdir(MEDIA_ASSETS_DIR, { recursive: true });
    await fs.mkdir(SKILLS_DIR, { recursive: true });
    
    // Create initial prompt if not exists

  } catch (err) {
    console.error("Error ensuring directories:", err);
  }
}

export async function startServer() {
  await ensureDirs();
  // Run SQLite Migration from JSON files
  runMigrationsFromFiles(MOVIES_DATA_DIR);
  ensureDeepMigration();
  ensureScriptSchema();
  ensureAssistantSchema();
  ensureInteractiveSchema();

  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const HOST = resolveServerBindHost();
  const operatorSecurityPolicy = createOperatorSecurityPolicy({
    token: process.env.OMNI_OPERATOR_API_TOKEN || process.env.OPERATOR_API_TOKEN,
    allowedProjectIds: process.env.OMNI_OPERATOR_ALLOWED_PROJECT_IDS || process.env.OPERATOR_ALLOWED_PROJECT_IDS,
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  registerManualAIRoutes(app);
  const assistantBatchRuntime = new ProductionPreparationBatchRuntime(generateServerGenericAIJson);
  assistantBatchRuntime.start();
  const sendOperatorSecurityError = (res: any, err: any) => {
    if (err instanceof OperatorSecurityError || err?.name === "OperatorSecurityError") {
      return res.status(err.statusCode || 403).json({
        error: err.message,
        code: err.code,
      });
    }
    return null;
  };

  const assertOperatorProjectAccess = (projectId?: string) => {
    assertOperatorProjectAllowed(operatorSecurityPolicy, projectId);
  };

  const resolveOperatorReadableProjectIds = (requestedProjectId?: string): Array<string | undefined> => {
    const projectId = String(requestedProjectId || "").trim();
    if (projectId) {
      assertOperatorProjectAccess(projectId);
      return [projectId];
    }
    return operatorSecurityPolicy.allowedProjectIds.length > 0
      ? operatorSecurityPolicy.allowedProjectIds
      : [undefined];
  };

  registerRuntimeRoutes(app, { compactRuntimeLogDetails });
  registerAiConfigRoutes(app, { getProviderKeyStatus });
  registerAssetRoutes(app, { mediaAssetsDir: MEDIA_ASSETS_DIR });
  registerProviderProxyRoutes(app, { mediaAssetsDir: MEDIA_ASSETS_DIR });

  registerLegacyProjectRoutes(app);
  const interactiveWritingPort = createInteractiveWritingPort(scriptRepository);
  registerInteractiveRoutes(app, {
    mediaAssetsDir: MEDIA_ASSETS_DIR,
    writingPort: interactiveWritingPort,
    productionPrepPort: createInteractiveProductionPrepPort({
      scriptRepository,
      writingPort: interactiveWritingPort,
      visualRefinementGenerator: generateServerGenericAIJson,
    }),
    graphDraftGenerator: generateServerGenericAIJson,
  });

  registerScriptRoutes(app, scriptRepository);
  scriptRuntime.register(app);

  registerAssistantRoutes(app, {
    generator: generateServerGenericAIJson,
    batchRuntime: assistantBatchRuntime,
    assertProjectAccess: assertOperatorProjectAccess,
  });

  app.use("/api/operator", (req, res, next) => {
    try {
      assertOperatorTokenAuthorized(
        operatorSecurityPolicy,
        extractOperatorTokenFromHeaders(req.headers as Record<string, unknown>),
      );
      next();
    } catch (err: any) {
      sendOperatorSecurityError(res, err) || res.status(500).json({ error: "Failed to authorize operator request" });
    }
  });

  registerOperatorMetadataRoutes(app, {
    operatorHandbookPath: OPERATOR_HANDBOOK_PATH,
    operatorSecurityPolicy,
  });

  registerOperatorProjectContextRoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    readOperatorHandbook,
    sendSecurityError: sendOperatorSecurityError,
  });

  registerOperatorCreativeChangeRoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    readOperatorHandbook,
    sendSecurityError: sendOperatorSecurityError,
  });

  registerOperatorProductionCockpitRoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    sendSecurityError: sendOperatorSecurityError,
  });

  registerOperatorStyleReferenceRoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    readOperatorHandbook,
    sendSecurityError: sendOperatorSecurityError,
  });

  registerOperatorStoryboardStrategyRoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    readOperatorHandbook,
    sendSecurityError: sendOperatorSecurityError,
  });

  registerOperatorCastingRoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    readOperatorHandbook,
    sendSecurityError: sendOperatorSecurityError,
  });

  registerOperatorLegacyProductionDraftRoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    readOperatorHandbook,
    sendSecurityError: sendOperatorSecurityError,
  });

  registerOperatorQARoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    sendSecurityError: sendOperatorSecurityError,
  });

  registerOperatorRunRoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    readOperatorHandbook,
    sendSecurityError: sendOperatorSecurityError,
  });

  registerOperatorArtifactRoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    sendSecurityError: sendOperatorSecurityError,
  });

  registerOperatorAssetRoutes(app, {
    store: dbHelpers,
    access: {
      assertProjectAccess: assertOperatorProjectAccess,
      resolveReadableProjectIds: resolveOperatorReadableProjectIds,
    },
    sendSecurityError: sendOperatorSecurityError,
  });

  registerVideoAnalysisRoutes(app);

  registerSystemRoutes(app, { mediaAssetsDir: MEDIA_ASSETS_DIR });
  registerPromptRoutes(app, { brainsDir: OMNI_BRAINS_DIR });
  registerSkillRoutes(app, { skillsDir: SKILLS_DIR });

  app.use("/api", (req, res) => {
    res.status(404).json({
      error: "API route not found",
      path: req.path,
    });
  });

  const apiOnly = process.env.OMNI_API_ONLY === "true";

  // Vite middleware for full-stack development. In split mode the frontend is served by Vite directly.
  if (!apiOnly && process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (!apiOnly) {
    app.use(express.static(path.join(__dirname, "dist"), { redirect: false }));
    app.get("*", (req, res) => {
      if (!shouldServeSpaDocument(req.path)) {
        res.status(404).type("text/plain").send("Static asset not found");
        return;
      }
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const server = await listenWithPortFallback(app, PORT, HOST, apiOnly);
  scriptRuntime.start();
  server.once("close", () => { void scriptRuntime.stop(); });
  return server;
}
