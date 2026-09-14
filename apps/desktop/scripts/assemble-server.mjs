#!/usr/bin/env node
/**
 * Assemble a self-contained server folder for the Tauri .app bundle.
 *
 * Layout produced in apps/desktop/src-tauri/server-dist:
 *   apps/web/
 *     server.js          <- Next standalone server entry (from .next/standalone)
 *     .next/             <- full production build output (server chunks + static)
 *     node_modules/      <- COMPLETE prod deps via `pnpm deploy --prod` (real files)
 *     prisma/            <- schema + seed
 *     package.json
 *     .env               <- generated desktop env
 *
 * Why not ship standalone's own node_modules?
 *   Next's .nft.json tracing only follows what the custom server.js can see at
 *   build time. App-route deps (next-auth, zod, bullmq, @swc/helpers, prisma
 *   engines, ...) are silently dropped, so the bundled server crashes with
 *   MODULE_NOT_FOUND. `pnpm deploy` gives the full, flattened prod tree
 *   instead — no symlinks, nothing host-absolute.
 */
import {
  cpSync,
  mkdirSync,
  existsSync,
  rmSync,
  writeFileSync,
  readdirSync,
  statSync,
  lstatSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const webDir = path.join(repoRoot, "apps/web");
const standalone = path.join(webDir, ".next/standalone");
const out = path.join(repoRoot, "apps/desktop/src-tauri/server-dist");
const webOut = path.join(out, "apps/web");

const fail = (msg) => {
  console.error(`[assemble-server] ERROR: ${msg}`);
  process.exit(1);
};

console.log("[assemble-server] standalone =", standalone, "exists", existsSync(standalone));
if (!existsSync(standalone)) {
  fail("Run `pnpm --filter @latex-ide/web build` first (needs output: standalone).");
}
const serverEntry = path.join(standalone, "apps/web/server.js");
if (!existsSync(serverEntry)) fail(`standalone entry missing: ${serverEntry}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(webOut, { recursive: true });

// ---------------------------------------------------------------------------
// 1) Full production dependency tree via pnpm deploy (real files, no symlinks)
//    postinstall (prisma generate) runs inside the deploy dir, so the
//    generated .prisma/client lands right there.
// ---------------------------------------------------------------------------
// Keep deploy on the same volume as the workspace. Windows runners often
// place TEMP on C: while the checkout is on D:, and pnpm 9 can then build
// malformed cross-drive dependency links during `pnpm deploy`.
const deployDir = path.join(repoRoot, ".yiyabo-deploy-temp");
rmSync(deployDir, { recursive: true, force: true });
process.on("exit", () => rmSync(deployDir, { recursive: true, force: true }));
console.log("[assemble-server] pnpm deploy --prod →", deployDir);
try {
  execSync(
    `pnpm --dir ${JSON.stringify(repoRoot)} --filter @latex-ide/web deploy --prod ${JSON.stringify(deployDir)}`,
    { stdio: "inherit" },
  );
} catch (e) {
  fail(`pnpm deploy failed: ${e.message}`);
}
if (!existsSync(path.join(deployDir, "node_modules"))) {
  fail("pnpm deploy produced no node_modules");
}

cpSync(path.join(deployDir, "node_modules"), path.join(webOut, "node_modules"), {
  recursive: true,
  dereference: true,
  force: true,
});
console.log("[assemble-server] copied production node_modules");

// Prisma engines live in <nm>/.prisma/client (postinstall). pnpm deploy often
// skips the client postinstall because prisma CLI is a devDep, so we copy the
// generated client from the repo's own node_modules — it's the same schema.
const prismaClientIdx = path.join(webOut, "node_modules", ".prisma", "client");
if (!existsSync(prismaClientIdx)) {
  console.warn("[assemble-server] .prisma/client missing after deploy, copying from repo store…");
  // Find the generated .prisma/client inside the monorepo's pnpm store.
  const dotPnpm = path.join(repoRoot, "node_modules", ".pnpm");
  let src = null;
  if (existsSync(dotPnpm)) {
    for (const d of readdirSync(dotPnpm)) {
      if (!d.startsWith("@prisma+client@")) continue;
      const cand = path.join(dotPnpm, d, "node_modules", ".prisma", "client");
      if (existsSync(cand) && existsSync(path.join(cand, "index.js"))) {
        src = cand;
        break;
      }
    }
  }
  if (!src) fail("no generated .prisma/client found in repo node_modules");
  const dest = path.join(webOut, "node_modules", ".prisma");
  mkdirSync(dest, { recursive: true });
  cpSync(src, path.join(dest, "client"), { recursive: true, dereference: true, force: true });
  console.log("[assemble-server] copied .prisma/client from repo store");
}

// ---------------------------------------------------------------------------
// 2) Server entry + build output from the standalone tree
// ---------------------------------------------------------------------------
cpSync(serverEntry, path.join(webOut, "server.js"));
console.log("[assemble-server] copied server.js");

// Full .next build output (server chunks, manifests) + static assets.
const standaloneNext = path.join(standalone, "apps/web/.next");
if (!existsSync(standaloneNext)) fail(`standalone .next missing: ${standaloneNext}`);
cpSync(standaloneNext, path.join(webOut, ".next"), { recursive: true, dereference: true, force: true });
const staticSrc = path.join(webDir, ".next/static");
if (existsSync(staticSrc)) {
  cpSync(staticSrc, path.join(webOut, ".next/static"), { recursive: true, force: true });
  console.log("[assemble-server] copied .next + .next/static");
} else {
  console.warn("[assemble-server] missing .next/static");
}

// public/ (standalone never includes it)
const publicSrc = path.join(webDir, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, path.join(webOut, "public"), { recursive: true, force: true });
  console.log("[assemble-server] copied public/");
}

// ---------------------------------------------------------------------------
// 3) package.json (prod deps list) + prisma schema
// ---------------------------------------------------------------------------
cpSync(path.join(webDir, "package.json"), path.join(webOut, "package.json"));
const prismaSrc = path.join(webDir, "prisma");
if (existsSync(prismaSrc)) {
  cpSync(prismaSrc, path.join(webOut, "prisma"), { recursive: true, force: true });
  console.log("[assemble-server] copied prisma/");
}

// ---------------------------------------------------------------------------
// 4) Desktop .env + marker
// ---------------------------------------------------------------------------
writeFileSync(
  path.join(out, "YIYABO_SERVER"),
  `assembled=${new Date().toISOString()}\nentry=apps/web/server.js\n`,
);
writeFileSync(
  path.join(webOut, ".env"),
  [
    "# YIYABO desktop .env (generated)",
    "DESKTOP_MODE=1",
    "NODE_ENV=production",
    'STORAGE_DRIVER="local"',
    'QUEUE_DRIVER="local"',
    'AI_PROVIDER="mock"',
    "",
  ].join("\n"),
);
console.log("[assemble-server] wrote desktop .env");

// ---------------------------------------------------------------------------
// 5) Prebuild an empty SQLite template DB (first-launch copy source)
// ---------------------------------------------------------------------------
try {
  const templateDb = path.join(out, "yiyabo-template.db");
  const tmpDb = path.join(webDir, ".yiyabo-template.db");
  rmSync(tmpDb, { force: true });
  execSync(`pnpm exec prisma db push --skip-generate --force-reset`, {
    cwd: webDir,
    env: { ...process.env, DATABASE_URL: `file:${tmpDb}` },
    stdio: "inherit",
  });
  if (existsSync(tmpDb)) {
    cpSync(tmpDb, templateDb);
    rmSync(tmpDb, { force: true });
    console.log("[assemble-server] wrote yiyabo-template.db");
  }
} catch (e) {
  console.warn("[assemble-server] prisma template db failed:", e.message);
}

// ---------------------------------------------------------------------------
// 6) @swc/helpers — next's own runtime dep, not a direct dependency, so pnpm
//    deploy omits it but next/dist/server/config.js requires it at boot.
// ---------------------------------------------------------------------------
const swcHelpersDest = path.join(webOut, "node_modules", "@swc", "helpers");
if (!existsSync(swcHelpersDest)) {
  const dotPnpm = path.join(repoRoot, "node_modules", ".pnpm");
  let src = null;
  if (existsSync(dotPnpm)) {
    for (const d of readdirSync(dotPnpm)) {
      if (!d.startsWith("@swc+helpers@")) continue;
      const cand = path.join(dotPnpm, d, "node_modules", "@swc", "helpers");
      if (existsSync(path.join(cand, "package.json"))) {
        src = cand;
        break;
      }
    }
  }
  if (!src) fail("no @swc/helpers found in repo node_modules/.pnpm");
  mkdirSync(path.dirname(swcHelpersDest), { recursive: true });
  cpSync(src, swcHelpersDest, { recursive: true, dereference: true, force: true });
  console.log("[assemble-server] copied @swc/helpers from repo store");
}

// ---------------------------------------------------------------------------
// 6b) Flatten pnpm's internal .pnpm store: hoist every .pnpm/*/node_modules/*
//     to the top level, then delete .pnpm. Node resolves transitive deps by
//     walking up, so one real copy per package is enough. This takes the
//     bundle from ~1.8 GB to a few hundred MB.
// ---------------------------------------------------------------------------
const dotPnpmDir = path.join(webOut, "node_modules", ".pnpm");
if (existsSync(dotPnpmDir)) {
  let hoisted = 0;
  for (const pkgDir of readdirSync(dotPnpmDir)) {
    const inner = path.join(dotPnpmDir, pkgDir, "node_modules");
    if (!existsSync(inner)) continue;
    for (const name of readdirSync(inner)) {
      const src = path.join(inner, name);
      const dest = path.join(webOut, "node_modules", name);
      if (existsSync(dest)) continue; // top level already has it — keep ours
      if (name.startsWith("@")) {
        mkdirSync(dest, { recursive: true });
        for (const sub of readdirSync(src)) {
          const subDest = path.join(dest, sub);
          if (existsSync(subDest)) continue;
          cpSync(path.join(src, sub), subDest, { recursive: true, dereference: true, force: true });
          hoisted++;
        }
      } else {
        cpSync(src, dest, { recursive: true, dereference: true, force: true });
        hoisted++;
      }
    }
  }
  rmSync(dotPnpmDir, { recursive: true, force: true });
  // .modules.yaml / .pnpm-state etc. are pnpm bookkeeping, not runtime files.
  for (const junk of [".modules.yaml", ".pnpm-state.json"]) {
    rmSync(path.join(webOut, "node_modules", junk), { force: true });
  }
  console.log("[assemble-server] flattened .pnpm store, hoisted", hoisted, "packages");
}

// ---------------------------------------------------------------------------
// 7) Materialize any remaining symlinks (pnpm deploy can leave .pnpm-internal
//    ones) and audit for escapes.
// ---------------------------------------------------------------------------
function materializeSymlinks(root) {
  let replaced = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        let target;
        try {
          target = realpathSync(p);
        } catch {
          rmSync(p, { force: true });
          continue;
        }
        rmSync(p, { force: true });
        try {
          const tst = statSync(target);
          if (tst.isDirectory()) {
            cpSync(target, p, { recursive: true, dereference: true, force: true });
          } else {
            cpSync(target, p, { force: true });
          }
          replaced++;
          if (statSync(p).isDirectory()) walk(p);
        } catch (err) {
          console.warn("[assemble-server] materialize failed", p, err.message);
        }
      } else if (e.isDirectory()) {
        walk(p);
      }
    }
  };
  walk(root);
  return replaced;
}
const nLinks = materializeSymlinks(out);
console.log("[assemble-server] materialized", nLinks, "symlinks");

let badLinks = 0;
(function audit(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      badLinks++;
      console.error("[assemble-server] REMAINING SYMLINK", p, "->", readlinkSync(p));
    } else if (e.isDirectory()) {
      audit(p);
    }
  }
})(out);
if (badLinks > 0) fail(`${badLinks} symlinks remain in the bundle`);

// ---------------------------------------------------------------------------
// 7) Smoke test: resolve every production dependency + boot-critical modules
//    against the assembled tree BEFORE tauri packages it.
// ---------------------------------------------------------------------------
const smokeTest = `
const path = require("path");
const nm = path.join(${JSON.stringify(webOut)}, "node_modules");
const req = require("module").createRequire(path.join(nm, "server.js"));
const pkgs = JSON.parse(require("fs").readFileSync(path.join(${JSON.stringify(webOut)}, "package.json"), "utf8"));
const names = [
  ...Object.keys(pkgs.dependencies || {}).filter((n) => !n.startsWith("@latex-ide/")),
  "@swc/helpers", ".prisma/client",
];
let failed = 0;
for (const n of names) {
  try { req.resolve(n); }
  catch (e) {
    // Packages without a root export (subpath-only) — check the dir exists instead.
    try {
      const pkgDir = path.join(nm, n);
      require("fs").accessSync(path.join(pkgDir, "package.json"));
      continue;
    } catch {}
    console.error("UNRESOLVABLE:", n, "-", e.message.split("\\n")[0]);
    failed++;
  }
}
if (failed) { console.error(failed + " modules failed to resolve"); process.exit(1); }
console.log("smoke test OK: " + names.length + " modules resolve");
`;
const smokeFile = path.join(os.tmpdir(), `yiyabo-smoke-${Date.now()}.cjs`);
writeFileSync(smokeFile, smokeTest);
try {
  execSync(`node ${JSON.stringify(smokeFile)}`, { stdio: "inherit" });
} catch {
  rmSync(smokeFile, { force: true });
  fail("dependency smoke test failed — bundle would crash at runtime");
}
rmSync(smokeFile, { force: true });

// ---------------------------------------------------------------------------
// 8) Report
// ---------------------------------------------------------------------------
const size = (() => {
  let total = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      try {
        if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
        else total += statSync(p).size;
      } catch {
        /* broken */
      }
    }
  };
  walk(out);
  return total;
})();

rmSync(deployDir, { recursive: true, force: true });
console.log("[assemble-server] done →", out, `(${(size / 1024 / 1024).toFixed(1)} MB)`);
