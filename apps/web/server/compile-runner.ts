import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CompileResult, LatexDiagnostic, LatexEngine } from "@latex-ide/contracts";
import { compileFailedFromLog, parseLatexLog } from "@latex-ide/latex";

export type CompileJobInput = {
  jobId: string;
  entryFile: string;
  engine: LatexEngine;
  workDir: string;
  timeoutMs?: number;
};

type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function engineBin(engine: LatexEngine): string {
  return engine; // pdflatex | xelatex | lualatex
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        TEXMFVAR: path.join(cwd, ".texmf-var"),
        TEXMFCONFIG: path.join(cwd, ".texmf-config"),
        TMPDIR: path.join(cwd, "tmp"),
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
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      stderr += String(err);
      resolve({ code: 1, stdout, stderr, timedOut });
    });
  });
}

async function isExecutable(cmd: string): Promise<boolean> {
  try {
    const st = await stat(cmd);
    if (st.isFile()) return true;
  } catch {
    // Continue with PATH lookup.
  }
  return new Promise((resolve) => {
    const locator = process.platform === "win32" ? "where.exe" : "which";
    const child = spawn(locator, [cmd], { stdio: "ignore", windowsHide: true });
    child.on("close", (code: number | null) => resolve(code === 0));
    child.on("error", () => resolve(false));
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
  try {
    const entries = await readdir(dir);
    const pdf = entries.find((e) => e.endsWith(".pdf"));
    if (pdf) return path.join(dir, pdf);
  } catch {
    /* ignore */
  }
  return null;
}

export async function createWorkDir(): Promise<string> {
  const root =
    process.env.COMPILE_TMP_ROOT || path.join(process.cwd(), "data", "compile-tmp");
  const dir = path.join(root, randomUUID());
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeProjectSnapshot(
  workDir: string,
  files: Array<{ path: string; content: string | Buffer }>,
): Promise<void> {
  for (const f of files) {
    const dest = path.join(workDir, f.path);
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

/**
 * Locate a bundled tectonic binary (self-contained TeX engine, ~20 MB).
 * Search order: env override → app bundle Resources → repo dev location.
 * Returns null when not bundled (fall back to system TeX).
 */
export async function findBundledTectonic(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.env.TECTONIC_PATH) candidates.push(process.env.TECTONIC_PATH);
  // Tauri resource dir (process.cwd() is <bundle>/Resources/server/apps/web)
  const cwd = process.cwd();
  const tectonicName = process.platform === "win32" ? "tectonic.exe" : "tectonic";
  candidates.push(path.resolve(cwd, `../../../tectonic/${tectonicName}`)); // server/apps/web → Resources
  candidates.push(path.resolve(cwd, `../../../../tectonic/${tectonicName}`));
  // Dev repo layout
  candidates.push(
    path.resolve(cwd, `../../../../resources/tectonic/${tectonicName}`),
  );
  candidates.push(path.resolve(cwd, `../../../../resources/tectonic/${tectonicName}`));
  for (const c of candidates) {
    if (await isExecutable(c)) return c;
  }
  return null;
}

/** Compile with bundled tectonic (self-contained; auto-downloads packages into its own cache). */
async function compileWithTectonic(
  tectonicPath: string,
  input: CompileJobInput,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const args = [
    "-X", "compile",
    input.entryFile,
    "--outdir", ".",
    "--keep-intermediates",
    "--print",
    "-Z",
    "continue-on-errors",
  ];
  return run(tectonicPath, args, input.workDir, timeoutMs);
}

export async function compileLocal(
  input: CompileJobInput,
): Promise<{ result: CompileResult; pdfPath?: string; logText: string }> {
  const started = Date.now();
  const timeoutMs =
    input.timeoutMs ?? Number(process.env.COMPILE_TIMEOUT_MS || 60_000);
  const workDir = input.workDir;
  const entry = path.basename(input.entryFile);
  const baseName = entry.replace(/\.tex$/i, "");
  const engine = input.engine;

  await mkdir(path.join(workDir, "tmp"), { recursive: true });
  await mkdir(path.join(workDir, ".texmf-var"), { recursive: true });
  await mkdir(path.join(workDir, ".texmf-config"), { recursive: true });

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = 0;
  let timedOut = false;

  const latexmk = process.env.LATEXMK_PATH || "latexmk";
  const useLatexmk = await isExecutable(latexmk);
  const enginePath = await (async () => {
    const bin = engineBin(engine);
    if (await isExecutable(bin)) return bin;
    const texbin = path.join("/Library/TeX/texbin", bin);
    if (await isExecutable(texbin)) return texbin;
    return null;
  })();

  const engineArgs = [
    "-interaction=nonstopmode",
    "-no-shell-escape",
    "-halt-on-error",
    "-file-line-error",
    entry,
  ];

  if (useLatexmk) {
    // Full system TeX (macOS/latexmk): supports every class + bibtex automatically
    const pdfMode = engine === "pdflatex" ? "-pdf" : `-${engine}`;
    const args = [
      pdfMode,
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
  } else if (enginePath) {
    // Bare system engine without latexmk: two manual passes
    const pass1 = await run(enginePath, engineArgs, workDir, timeoutMs);
    stdout += pass1.stdout;
    stderr += pass1.stderr;
    if (pass1.timedOut) {
      timedOut = true;
      exitCode = pass1.code;
    } else {
      const pass2 = await run(enginePath, engineArgs, workDir, timeoutMs);
      stdout += pass2.stdout;
      stderr += pass2.stderr;
      exitCode = pass2.code;
      timedOut = timedOut || pass2.timedOut;
    }
  } else {
    // No system TeX — fall back to the bundled self-contained engine.
    const tectonic = await findBundledTectonic();
    if (!tectonic) {
      return {
        result: {
          jobId: input.jobId,
          status: "failed",
          diagnostics: [
            {
              severity: "error",
              message:
                process.platform === "win32"
                  ? "未找到 LaTeX 引擎：应用内置 Tectonic 不可用，请安装 MiKTeX 或 TeX Live 后重试。"
                  : "未找到 LaTeX 引擎：本机未安装 TeX 发行版（如 MacTeX），应用内置引擎也不可用。请安装 MacTeX 后重试。",
            },
          ],
          durationMs: Date.now() - started,
        },
        logText: "",
      };
    }
    const res = await compileWithTectonic(tectonic, input, timeoutMs);
    stdout = res.stdout;
    stderr = res.stderr;
    exitCode = res.code;
    timedOut = res.timedOut;
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
