import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "./db";
import { getStorage } from "./storage";
import { getProjectCompileSnapshot } from "./files";
import {
  cleanupWorkDir,
  compileLocal,
  createWorkDir,
  writeProjectSnapshot,
} from "./compile-runner";
import type { CompileResult, LatexDiagnostic, LatexEngine } from "@latex-ide/contracts";

type JobState = {
  result: CompileResult;
  pdfKey?: string;
};

const jobStore = new Map<string, JobState>();

export async function enqueueCompile(
  projectId: string,
  entryFile: string,
  engine: LatexEngine,
): Promise<string> {
  const jobId = randomUUID();
  await db.compileJob.create({
    data: {
      id: jobId,
      projectId,
      entryFile,
      engine,
      status: "queued",
    },
  });

  void runCompileJob(jobId, projectId, entryFile, engine).catch((err) => {
    console.error("[compile] job failed", jobId, err);
    jobStore.set(jobId, {
      result: {
        jobId,
        status: "failed",
        diagnostics: [{ severity: "error", message: String(err) }],
        durationMs: 0,
      },
    });
    void db.compileJob
      .update({ where: { id: jobId }, data: { status: "failed", durationMs: 0 } })
      .catch(() => {});
  });

  return jobId;
}

async function runCompileJob(
  jobId: string,
  projectId: string,
  entryFile: string,
  engine: LatexEngine,
) {
  await db.compileJob.update({ where: { id: jobId }, data: { status: "running" } });

  const files = await getProjectCompileSnapshot(projectId);
  const workDir = await createWorkDir();
  let result: CompileResult;
  let pdfPath: string | undefined;

  let pdfKey: string | undefined;
  try {
    await writeProjectSnapshot(workDir, files);
    const out = await compileLocal({ jobId, entryFile, engine, workDir });
    result = out.result;
    pdfPath = out.pdfPath;

    // Read PDF before workdir cleanup
    if (pdfPath && result.status === "success") {
      const pdfBuf = await readFile(pdfPath);
      pdfKey = `projects/${projectId}/build/${jobId}.pdf`;
      await getStorage().put(pdfKey, pdfBuf);
      result = { ...result, pdfUrl: getStorage().publicUrl(pdfKey) };
    }
  } finally {
    await cleanupWorkDir(workDir).catch(() => {});
  }

  jobStore.set(jobId, { result, pdfKey });

  await db.compileJob.update({
    where: { id: jobId },
    data: {
      status: result.status,
      diagnostics: result.diagnostics as unknown as object,
      pdfKey,
      durationMs: result.durationMs,
    },
  });
}

export async function getCompileResult(jobId: string): Promise<CompileResult | null> {
  const cached = jobStore.get(jobId);
  if (cached) return cached.result;

  const job = await db.compileJob.findUnique({ where: { id: jobId } });
  if (!job) return null;

  const status = job.status as CompileResult["status"];
  if (status === "queued" || status === "running") {
    return { jobId, status, diagnostics: [], durationMs: 0 };
  }

  const storage = getStorage();
  return {
    jobId,
    status,
    pdfUrl: job.pdfKey ? storage.publicUrl(job.pdfKey) : undefined,
    diagnostics: (job.diagnostics as unknown as LatexDiagnostic[]) || [],
    durationMs: job.durationMs,
  };
}

export async function getPdfBuffer(jobId: string): Promise<Buffer | null> {
  const cached = jobStore.get(jobId);
  const key = cached?.pdfKey;
  if (!key) {
    const job = await db.compileJob.findUnique({ where: { id: jobId } });
    if (!job?.pdfKey) return null;
    return getStorage().get(job.pdfKey);
  }
  return getStorage().get(key);
}
