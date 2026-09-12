/**
 * Standalone compile worker entry.
 * When QUEUE_DRIVER=local, compilation runs in-process via the web app.
 * This process is for QUEUE_DRIVER=bullmq (Redis) deployments.
 */
import { config } from "dotenv";
import path from "node:path";
import {
  cleanupWorkDir,
  compileDocker,
  compileLocal,
  createWorkDir,
  dockerAvailable,
  writeProjectSnapshot,
} from "./compiler";

config({ path: path.resolve(__dirname, "../../../.env") });

export type WorkerCompilePayload = {
  jobId: string;
  projectId: string;
  entryFile: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
  files: Array<{ path: string; content: string }>;
};

export async function executeCompileJob(payload: WorkerCompilePayload) {
  const workDir = await createWorkDir();
  try {
    await writeProjectSnapshot(workDir, payload.files);
    const driver = process.env.COMPILE_DRIVER || "local";
    const useDocker = driver === "docker" && (await dockerAvailable());
    const input = {
      jobId: payload.jobId,
      entryFile: payload.entryFile,
      engine: payload.engine,
      workDir,
    };
    return useDocker ? await compileDocker(input) : await compileLocal(input);
  } finally {
    await cleanupWorkDir(workDir);
  }
}

// BullMQ consumer is loaded only when Redis is configured
async function main() {
  if (process.env.QUEUE_DRIVER !== "bullmq") {
    console.log(
      "[worker-compile] QUEUE_DRIVER is not bullmq — this process is idle.\n" +
        "Compilation runs in-process inside the web app (QUEUE_DRIVER=local).",
    );
    // Keep process alive for parity with a worker daemon
    setInterval(() => {}, 1 << 30);
    return;
  }

  // Dynamic import so local mode has zero Redis dependency
  const { Worker } = await import("bullmq");
  const connection = { url: process.env.REDIS_URL || "redis://localhost:6379" };
  const IORedis = (await import("ioredis")).default;
  const conn = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    "compile",
    async (job) => {
      console.log(`[worker-compile] running job ${job.id}`);
      const out = await executeCompileJob(job.data as WorkerCompilePayload);
      return out.result;
    },
    {
      connection: conn,
      concurrency: Number(process.env.COMPILE_CONCURRENCY || 2),
    },
  );

  worker.on("completed", (...args: unknown[]) => {
    const job = args[0] as { id?: string } | undefined;
    console.log(`[worker-compile] completed ${job?.id}`);
  });
  worker.on("failed", (...args: unknown[]) => {
    const job = args[0] as { id?: string } | undefined;
    const err = args[1];
    console.error(`[worker-compile] failed ${job?.id}`, err);
  });

  console.log("[worker-compile] BullMQ worker started");
  void connection;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
