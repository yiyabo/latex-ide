import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CompileResult,
  LatexDiagnostic,
  LatexEngine,
} from "@latex-ide/contracts";
import { compileFailedFromLog, parseLatexLog } from "@latex-ide/latex";

export type CompileJobInput = {
  jobId: string;
  entryFile: string;
  engine: LatexEngine;
  /** Absolute path to a directory containing the project snapshot */
  workDir: string;
  timeoutMs?: number;
};

const ENGINE_BIN: Record<LatexEngine, string> = {
  pdflatex: "pdflatex",
  xelatex: "xelatex",
  lualatex: "lualatex",
};

function engineArgs(engine: LatexEngine): string[] {
  const bin = ENGINE_BIN[engine];
  if (bin === "xelatex" || bin === "lualatex") {
    return [
      "-interaction=nonstopmode",
      "-no-shell-escape",
      "-halt-on-error",
    ];
  }
  return ["-interaction=nonstopmode", "-no-shell-escape", "-halt-on-error"];
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: {
        PATH: process.env.PATH,
        TEXMFVAR: path.join(cwd, ".texmf-var"),
        TEXMFCONFIG: path.join(cwd, ".texmf-config"),
        TEXMFSYSVAR: process.env.TEXMFSYSVAR,
        TMPDIR: path.join(cwd, "tmp"),
        // Explicitly drop network proxies / secrets from compile env
        HOME: cwd,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      stderr += String(err);
      resolve({ code: 1, stdout, stderr, timedOut });
    });
  });
}

async function findPdf(dir: string, baseName: string): Promise<string | null> {
  const candidate = path.join(dir, `${baseName}.pdf`);
  try {
    const s = await stat(candidate);
    if (s.isFile()) return candidate;
  } catch {
    /* ignore */
  }
  // fallback: any pdf in dir
  try {
    const entries = await readdir(dir);
    const pdf = entries.find((e) => e.endsWith(".pdf"));
    if (pdf) return path.join(dir, pdf);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Compile a project directory with local latexmk/pdflatex.
 * Used when Docker is unavailable. Still enforces timeout and no shell-escape.
 */
export async function compileLocal(
  input: CompileJobInput,
): Promise<{ result: CompileResult; pdfPath?: string; logText: string }> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? Number(process.env.COMPILE_TIMEOUT_MS || 60_000);
  const workDir = input.workDir;
  const entry = path.basename(input.entryFile);
  const baseName = entry.replace(/\.tex$/i, "");
  const engine = input.engine;

  await mkdir(path.join(workDir, "tmp"), { recursive: true });
  await mkdir(path.join(workDir, ".texmf-var"), { recursive: true });
  await mkdir(path.join(workDir, ".texmf-config"), { recursive: true });

  // Prefer latexmk if available for multi-pass; fall back to direct engine.
  const latexmk = process.env.LATEXMK_PATH || "latexmk";
  const useLatexmk = await isExecutable(latexmk);

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = 0;
  let timedOut = false;

  if (useLatexmk) {
    const args = [
      `-${engine === "pdflatex" ? "pdf" : engine}`,
      "-interaction=nonstopmode",
      "-no-shell-escape",
      "-halt-on-error",
      "-file-line-error",
      entry,
    ];
    const res = await run(latexmk, args, workDir, timeoutMs);
    stdout = res.stdout;
    stderr = res.stderr;
    exitCode = res.code;
    timedOut = res.timedOut;
  } else {
    // Two-pass fallback
    const args = [...engineArgs(engine), "-file-line-error", entry];
    const pass1 = await run(ENGINE_BIN[engine], args, workDir, timeoutMs);
    stdout += pass1.stdout;
    stderr += pass1.stderr;
    if (pass1.timedOut) {
      timedOut = true;
      exitCode = pass1.code;
    } else {
      const pass2 = await run(ENGINE_BIN[engine], args, workDir, timeoutMs);
      stdout += pass2.stdout;
      stderr += pass2.stderr;
      exitCode = pass2.code;
      timedOut = timedOut || pass2.timedOut;
    }
  }

  const logPath = path.join(workDir, `${baseName}.log`);
  let logText = "";
  try {
    logText = await readFile(logPath, "utf8");
  } catch {
    logText = `${stdout}\n${stderr}`;
  }

  const durationMs = Date.now() - started;

  if (timedOut) {
    return {
      result: {
        jobId: input.jobId,
        status: "timeout",
        diagnostics: [
          {
            severity: "error",
            message: `Compilation timed out after ${timeoutMs}ms`,
          },
        ],
        durationMs,
      },
      logText,
    };
  }

  const failed = compileFailedFromLog(logText, exitCode ?? 1);
  const diagnostics: LatexDiagnostic[] = parseLatexLog(logText, entry);

  if (failed) {
    if (diagnostics.length === 0) {
      diagnostics.push({
        severity: "error",
        message: `Compilation failed with exit code ${exitCode}`,
        raw: stderr.slice(0, 2000) || stdout.slice(0, 2000),
      });
    }
    return {
      result: {
        jobId: input.jobId,
        status: "failed",
        diagnostics,
        durationMs,
      },
      logText,
    };
  }

  const pdfPath = (await findPdf(workDir, baseName)) || undefined;
  return {
    result: {
      jobId: input.jobId,
      status: "success",
      diagnostics,
      durationMs,
    },
    pdfPath,
    logText,
  };
}

async function isExecutable(cmd: string): Promise<boolean> {
  if (cmd.includes("/")) {
    try {
      await stat(cmd);
      return true;
    } catch {
      return false;
    }
  }
  return new Promise((resolve) => {
    const child = spawn("which", [cmd], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/**
 * Docker sandbox compile — used when COMPILE_DRIVER=docker and daemon is up.
 * Mirrors ARCHITECTURE §6 hard requirements.
 */
export async function compileDocker(
  input: CompileJobInput,
): Promise<{ result: CompileResult; pdfPath?: string; logText: string }> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? Number(process.env.COMPILE_TIMEOUT_MS || 60_000);
  const image = process.env.COMPILE_DOCKER_IMAGE || "latex-ide-texlive:latest";
  const workDir = input.workDir;
  const entry = path.basename(input.entryFile);
  const baseName = entry.replace(/\.tex$/i, "");
  const outDir = path.join(workDir, "out");
  await mkdir(outDir, { recursive: true });

  const containerName = `latex-compile-${randomUUID()}`;
  const engine = input.engine;
  const pdfMode = engine === "pdflatex" ? "-pdf" : `-${engine}`;

  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network=none",
    "--memory=2g",
    "--cpus=2",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "-v",
    `${workDir}:/project:ro`,
    "-v",
    `${outDir}:/out:rw`,
    "--user",
    "1000:1000",
    image,
    "latexmk",
    pdfMode,
    "-interaction=nonstopmode",
    "-no-shell-escape",
    "-halt-on-error",
    "-file-line-error",
    `-outdir=/out`,
    `/project/${entry}`,
  ];

  const res = await run("docker", args, workDir, timeoutMs + 5000);
  const durationMs = Date.now() - started;

  let logText = res.stdout + "\n" + res.stderr;
  try {
    logText = await readFile(path.join(outDir, `${baseName}.log`), "utf8");
  } catch {
    /* keep stdout */
  }

  // Best-effort container cleanup
  void run("docker", ["rm", "-f", containerName], workDir, 5000);

  const diagnostics = parseLatexLog(logText, entry);

  if (res.timedOut) {
    return {
      result: {
        jobId: input.jobId,
        status: "timeout",
        diagnostics: [
          { severity: "error", message: `Compilation timed out after ${timeoutMs}ms` },
        ],
        durationMs,
      },
      logText,
    };
  }

  const pdfPath = (await findPdf(outDir, baseName)) || undefined;
  const failed = compileFailedFromLog(logText, res.code ?? 1);

  if (failed && !pdfPath) {
    return {
      result: {
        jobId: input.jobId,
        status: "failed",
        diagnostics:
          diagnostics.length > 0
            ? diagnostics
            : [{ severity: "error", message: `Exit code ${res.code}` }],
        durationMs,
      },
      logText,
    };
  }

  return {
    result: {
      jobId: input.jobId,
      status: "success",
      diagnostics,
      durationMs,
    },
    pdfPath,
    logText,
  };
}

export async function createWorkDir(base?: string): Promise<string> {
  const root = base || process.env.COMPILE_TMP_ROOT || path.join(process.cwd(), "data", "compile-tmp");
  const dir = path.join(root, randomUUID());
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeProjectSnapshot(
  workDir: string,
  files: Array<{ path: string; content: Buffer | string }>,
): Promise<void> {
  for (const f of files) {
    const dest = path.join(workDir, f.path);
    // Prevent path escape
    const resolved = path.resolve(dest);
    if (!resolved.startsWith(path.resolve(workDir))) {
      throw new Error(`Illegal path in snapshot: ${f.path}`);
    }
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, f.content);
  }
}

export async function cleanupWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function dockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["info"], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}
