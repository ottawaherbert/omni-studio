import type {
  CreateProductionRunOptions,
  ProductionRun,
  ProductionRunProjectInput,
} from "../../../src/types/production";
import { createProductionRun } from "../../../src/services/production/orchestrator";
export type WorkerJobKind = "production";
export type WorkerJobStatus = "queued" | "running" | "completed" | "failed";

export interface WorkerJobEnvelope<TResult, TKind extends WorkerJobKind = WorkerJobKind> {
  id: string;
  kind: TKind;
  status: WorkerJobStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: TResult;
}

export interface RunProductionWorkerJobInput {
  project: ProductionRunProjectInput;
  options?: CreateProductionRunOptions;
  executeRun?: (run: ProductionRun) => Promise<ProductionRun> | ProductionRun;
  jobId?: string;
  now?: number;
}

const createWorkerJobId = (kind: WorkerJobKind) => `worker_${kind}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

const createEnvelope = <TResult, TKind extends WorkerJobKind>(
  kind: TKind,
  jobId?: string,
  now = Date.now(),
): WorkerJobEnvelope<TResult, TKind> => ({
  id: jobId || createWorkerJobId(kind),
  kind,
  status: "queued",
  createdAt: now,
});

const runWorkerTask = async <TResult, TKind extends WorkerJobKind>(
  envelope: WorkerJobEnvelope<TResult, TKind>,
  task: () => Promise<TResult>,
) => {
  envelope.status = "running";
  envelope.startedAt = Date.now();
  try {
    envelope.result = await task();
    envelope.status = "completed";
  } catch (err) {
    envelope.status = "failed";
    envelope.error = err instanceof Error ? err.message : String(err);
  } finally {
    envelope.completedAt = Date.now();
  }
  return envelope;
};

export const runProductionWorkerJob = (input: RunProductionWorkerJobInput) =>
  runWorkerTask(
    createEnvelope<{ run: ProductionRun }, "production">("production", input.jobId, input.now),
    async () => {
      const run = createProductionRun(input.project, input.options);
      return { run: input.executeRun ? await input.executeRun(run) : run };
    },
  );
