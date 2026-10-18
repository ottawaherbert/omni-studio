import { productionClient } from "../../clients/productionClient";
import { defaultTemplates } from "../../config/prompts";
import { PromptTemplate } from "../../config/prompts/types";
import { ProductionTemplateTrace } from "../../types/production";
import {
  productionTemplateMetadataRegistry,
  validateProductionTemplateMetadata,
} from "./templateMetadata";
import { extractPromptTemplateVariables } from "./promptUtils";

export interface LoadedProductionTemplate {
  template: string;
  trace: ProductionTemplateTrace;
}

const localStorageTemplate = (id: string): PromptTemplate | undefined => {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem("omni-prompt-storage");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    const templates = parsed?.state?.templates || parsed?.templates;
    const template = templates?.[id];
    return typeof template?.template === "string" ? template : undefined;
  } catch {
    return undefined;
  }
};

const serverTemplate = async (id: string): Promise<string | undefined> => {
  try {
    return productionClient.getPromptTemplateContent(id);
  } catch {
    return undefined;
  }
};

const templateTrace = (
  id: string,
  trace: Omit<ProductionTemplateTrace, "id" | "metadata" | "metadataWarnings">,
  extraWarnings: string[] = [],
): ProductionTemplateTrace => {
  const metadata = productionTemplateMetadataRegistry[id];
  return {
    id,
    ...trace,
    metadata,
    metadataWarnings: [
      ...validateProductionTemplateMetadata(metadata),
      ...extraWarnings,
    ],
  };
};

const validateTemplateBodyVariables = (id: string, template: string) => {
  const metadata = productionTemplateMetadataRegistry[id];
  if (!metadata?.requiredVariables?.length) return [];
  const variables = new Set(extractPromptTemplateVariables(template));
  return metadata.requiredVariables
    .filter((variable) => !variables.has(variable))
    .map((variable) => `模板正文缺少必需变量 {{${variable}}}。`);
};

const builtinTemplateFor = (id: string, fallback?: PromptTemplate) =>
  fallback || defaultTemplates[id];

const loadBuiltinTemplate = (
  id: string,
  fallback: PromptTemplate | undefined,
  extraWarnings: string[] = [],
): LoadedProductionTemplate => {
  const builtinDefault = defaultTemplates[id];
  const builtin = builtinTemplateFor(id, fallback);
  const source = builtinDefault ? "config.defaultTemplates" : fallback ? "runner.inline" : "unknown";
  const template = builtin?.template || "";
  return {
    template,
    trace: templateTrace(id, {
      name: builtin?.name || id,
      source,
      version: source === "runner.inline" ? "unversioned" : builtin ? "builtin" : "missing",
      path: source === "config.defaultTemplates" ? "src/config/prompts" : undefined,
    }, [
      ...extraWarnings,
      ...validateTemplateBodyVariables(id, template),
    ]),
  };
};

export const loadProductionPromptTemplate = async (
  id: string,
  fallback?: PromptTemplate,
): Promise<LoadedProductionTemplate> => {
  const local = localStorageTemplate(id);
  if (local) {
    const bodyWarnings = validateTemplateBodyVariables(id, local.template);
    if (bodyWarnings.length > 0) {
      return loadBuiltinTemplate(id, fallback, [
        `已忽略 localStorage 自定义模板 ${id}，因为正文变量契约不完整。`,
        ...bodyWarnings,
      ]);
    }
    return {
      template: local.template,
      trace: templateTrace(id, {
        name: local.name || fallback?.name || id,
        source: "manual.custom",
        version: "localStorage",
      }),
    };
  }

  const server = await serverTemplate(id);
  if (server) {
    const bodyWarnings = validateTemplateBodyVariables(id, server);
    if (bodyWarnings.length > 0) {
      return loadBuiltinTemplate(id, fallback, [
        `已忽略服务端模板 ${id}，因为正文变量契约不完整。`,
        ...bodyWarnings,
      ]);
    }
    return {
      template: server,
      trace: templateTrace(id, {
        name: fallback?.name || id,
        source: "server.prompt",
        version: "OMNI_Brains",
        path: `OMNI_Brains/${id}.md`,
      }),
    };
  }

  return loadBuiltinTemplate(id, fallback);
};

export const renderPromptWithContext = async (
  templateId: string,
  project: any,
  variables: Record<string, string | number | undefined>,
  fallback?: PromptTemplate,
): Promise<{ prompt: string; trace: ProductionTemplateTrace }> => {
  const loaded = await loadProductionPromptTemplate(templateId, fallback);
  const { renderPromptTemplate } = await import("./promptUtils");
  
  const contextVars = {
    ...variables,
    projectTitle: project?.title || "",
    projectType: project?.type || "",
    logline: project?.logline || "",
    coreConflict: project?.coreConflict || "",
  };

  const prompt = renderPromptTemplate(loaded.template, contextVars);
  return { prompt, trace: loaded.trace };
};
