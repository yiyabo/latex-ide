import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";

/**
 * Unit tests for the zip-import safety invariants.
 * These mirror the checks in apps/web/server/import.ts.
 * (The route itself needs a DB session; here we verify the building blocks
 * and the filter logic against crafted archives.)
 */

function zipToEntries(buf: Buffer): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(buf));
}

function makeZip(files: Record<string, string | Uint8Array>): Buffer {
  // Minimal zip writer via fflate's sync API is not exposed for creation in
  // all versions; use a tiny store-only zip builder.
  const { zipSync, strToU8 } = require("fflate") as typeof import("fflate");
  const data: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) {
    data[k] = typeof v === "string" ? strToU8(v) : v;
  }
  return Buffer.from(zipSync(data));
}

function isJunkPath(p: string): boolean {
  const parts = p.split("/");
  return parts.some(
    (seg) =>
      seg === "__MACOSX" ||
      seg === ".DS_Store" ||
      seg.startsWith("._") ||
      seg === ".git" ||
      seg === ".gitignore" ||
      seg === ".vscode" ||
      seg === ".idea",
  );
}

function isSafeProjectPath(path: string): boolean {
  if (!path || path.length > 255) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (path.includes("..")) return false;
  if (path.includes("\0")) return false;
  const parts = path.split("/");
  return parts.every((p) => p.length > 0 && p !== "." && p !== "..");
}

function stripCommonRoot(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const paths = [...files.keys()];
  if (paths.length < 2) return files;
  const first = paths[0]!;
  const root = first.split("/")[0];
  if (!root) return files;
  const allShareRoot = paths.every((p) => p.startsWith(`${root}/`));
  if (!allShareRoot) return files;
  const out = new Map<string, Uint8Array>();
  for (const [p, data] of files) out.set(p.slice(root.length + 1), data);
  return out;
}

describe("zip import safety", () => {
  it("rejects zip-slip paths (../ escape)", () => {
    expect(isSafeProjectPath("../../etc/passwd")).toBe(false);
    expect(isSafeProjectPath("a/../../b.tex")).toBe(false);
    expect(isSafeProjectPath("main.tex")).toBe(true);
    expect(isSafeProjectPath("sections/intro.tex")).toBe(true);
  });

  it("filters junk entries (__MACOSX, .DS_Store, .git)", () => {
    expect(isJunkPath("__MACOSX/paper/._main.tex")).toBe(true);
    expect(isJunkPath("paper/.DS_Store")).toBe(true);
    expect(isJunkPath("paper/.git/config")).toBe(true);
    expect(isJunkPath("paper/main.tex")).toBe(false);
  });

  it("strips a single common top-level folder", () => {
    const files = new Map<string, Uint8Array>([
      ["my-paper/main.tex", new Uint8Array([1])],
      ["my-paper/sections/intro.tex", new Uint8Array([2])],
    ]);
    const out = stripCommonRoot(files);
    expect([...out.keys()].sort()).toEqual(["main.tex", "sections/intro.tex"]);
  });

  it("does NOT strip when files sit at multiple roots", () => {
    const files = new Map<string, Uint8Array>([
      ["main.tex", new Uint8Array([1])],
      ["sections/intro.tex", new Uint8Array([2])],
    ]);
    const out = stripCommonRoot(files);
    expect([...out.keys()].sort()).toEqual(["main.tex", "sections/intro.tex"]);
  });

  it("round-trips a crafted archive with slip + junk entries", () => {
    const buf = makeZip({
      "paper/main.tex": "\\documentclass{article}\\begin{document}x\\end{document}",
      "paper/refs.bib": "@article{a, author={A}}",
      "paper/../../evil.tex": "evil",
      "__MACOSX/paper/._main.tex": "junk",
      "paper/.DS_Store": "junk",
      "paper/data.csv": "a,b",
    });
    const entries = zipToEntries(buf);
    const accepted: string[] = [];
    const skipped: string[] = [];
    for (const [name, data] of Object.entries(entries)) {
      if (name.endsWith("/")) continue;
      if (isJunkPath(name)) continue;
      if (!isSafeProjectPath(name)) {
        skipped.push(`${name} (unsafe path)`);
        continue;
      }
      const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
      if (![".tex", ".bib", ".cls", ".sty", ".bst", ".txt", ".md", ".png", ".jpg", ".pdf"].includes(ext)) {
        skipped.push(`${name} (unsupported type)`);
        continue;
      }
      accepted.push(name);
      expect(strFromU8(data)).toBeDefined();
    }
    expect(accepted.sort()).toEqual(["paper/main.tex", "paper/refs.bib"]);
    expect(skipped).toContain("paper/../../evil.tex (unsafe path)");
  });
});
