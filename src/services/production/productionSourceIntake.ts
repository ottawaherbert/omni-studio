import { createMagicImportSourceSnapshot } from "./magicImportSourceSnapshot";
import { createProductionScriptWorkspace } from "./productionScriptWorkspace";
import { createEmptyVisualStyleTreatment, visualStyleContentHash } from "./visualStyleMigration";

import type {
  Episode,
  ProductionSourceDocument,
  Project,
  ProjectType,
  VisualImplementationMedium,
} from "../../types/project";

export type ProductionMagicSourceFormat = "script" | "novel";
export type ProductionMagicTargetFormat = Extract<ProjectType, "movie" | "tv-series" | "short-drama">;

export interface CreateProductionProjectFromMagicSourceInput {
  projectId: string;
  importId: string;
  title: string;
  sourceFormat: ProductionMagicSourceFormat;
  targetFormat: ProductionMagicTargetFormat;
  aspectRatio?: "16:9" | "9:16";
  visualStyleSeed?: VisualImplementationMedium;
  sourceDocuments: ProductionSourceDocument[];
  importedAt?: number;
}

const aspectRatioFor = (format: ProductionMagicTargetFormat) =>
  format === "short-drama" ? "9:16" : "16:9";

const rawSourceText = (documents: ProductionSourceDocument[]) => documents
  .filter((document) => !document.originalSourceDocumentId)
  .sort((left, right) => left.order - right.order)
  .map((document) => `【${document.title}】\n${document.content}`)
  .join("\n\n");

/**
 * Creates a production project from author-supplied source documents only.
 * It deliberately creates empty production scopes: scene planning starts later
 * from the adopted source text, never by interpreting the import itself.
 */
export const createProductionProjectFromMagicSource = (
  input: CreateProductionProjectFromMagicSourceInput,
): Project => {
  const importedAt = input.importedAt ?? Date.now();
  const workRanges = input.sourceDocuments
    .filter((document) => document.isWorkRange !== false)
    .sort((left, right) => left.order - right.order);
  if (!workRanges.length) throw new Error("请至少采用一份可进入制片筹备的剧本文本。");

  const episodes: Episode[] = workRanges.map((document) => ({
    id: `prod_scope_${document.id}`,
    sourceDocumentId: document.id,
    title: document.title,
    inspiration: "",
    scenes: [],
  }));

  const visualStyleLock = input.visualStyleSeed ? {
    schemaVersion: "visual-style-lock.v3" as const,
    revision: 1,
    contentHash: "",
    visualImplementation: structuredClone(input.visualStyleSeed),
    treatment: createEmptyVisualStyleTreatment(),
    mediumAssignments: [],
    sourceReview: {
      status: "current" as const,
      changedFields: [],
      detectedAt: importedAt,
      basedOnRevision: 1,
    },
    humanApprovalState: "draft" as const,
    source: "project_creation" as const,
  } : undefined;
  if (visualStyleLock) visualStyleLock.contentHash = visualStyleContentHash(visualStyleLock);

  const project: Project = {
    id: input.projectId,
    title: input.title,
    type: input.targetFormat,
    projectModel: "linear",
    aspectRatio: input.aspectRatio || aspectRatioFor(input.targetFormat),
    logline: "",
    coreConflict: "",
    targetEpisodeCount: input.targetFormat === "movie" ? undefined : workRanges.length,
    creativeVision: { genre: [], visualStyle: "", narrativeStyle: "", referenceWorks: "" },
    visualStyleLock,
    characters: [],
    assets: [],
    episodes,
    productionSourceSnapshot: createMagicImportSourceSnapshot({
      importId: input.importId,
      importedAt,
      sourceText: rawSourceText(input.sourceDocuments),
      sourceFormat: input.sourceFormat,
      targetFormat: input.targetFormat,
      sourceArtifact: {
        schemaVersion: "production-magic-source-artifact.v2",
        documents: input.sourceDocuments,
      },
    }),
    productionSourceDocuments: input.sourceDocuments,
    productionScenePlans: [],
    isFromAdaptation: true,
  };
  return {
    ...project,
    productionScriptWorkspace: createProductionScriptWorkspace(project, input.sourceDocuments, importedAt),
  };
};
