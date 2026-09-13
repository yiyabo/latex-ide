#!/usr/bin/env node
/**
 * Build the DMG with plain hdiutil — no AppleScript/Finder automation.
 * (tauri's bundle_dmg.sh requires Finder automation permission and fails
 * in CI/headless environments; this keeps build:app fully unattended.)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tauriDir = path.resolve(__dirname, "../src-tauri");
const appBundle = path.join(tauriDir, "target/release/bundle/macos/yiyabo.app");
const dmgDir = path.join(tauriDir, "target/release/bundle/dmg");
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
const version = pkg.version;
const dmgPath = path.join(dmgDir, `yiyabo_${version}_aarch64.dmg`);

if (!existsSync(appBundle)) {
  console.error("[make-dmg] app bundle missing:", appBundle);
  process.exit(1);
}
mkdirSync(dmgDir, { recursive: true });

// Eject any stale yiyabo volumes from previous runs
try {
  execSync("hdiutil detach /Volumes/yiyabo -quiet 2>/dev/null || true", { shell: "/bin/zsh" });
} catch { /* ignore */ }

// Staging folder: the app + Applications symlink (drag-to-install)
const staging = path.join(dmgDir, ".dmg-staging");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(appBundle, path.join(staging, "yiyabo.app"), { recursive: true });
execSync(`ln -s /Applications "${path.join(staging, "Applications")}"`);

execSync(
  `hdiutil create -volname "yiyabo" -srcfolder "${staging}" -ov -format UDZO "${dmgPath}"`,
  { stdio: "inherit" },
);
rmSync(staging, { recursive: true, force: true });

// Spotlight: keep the build tree out of indexing — a rebuilt target/ loses
// its .metadata_never_index marker, and bundle/macos/yiyabo.app then shows
// up in Spotlight as a second "yiyabo" next to /Applications/yiyabo.app.
const neverIndex = path.join(tauriDir, "target/.metadata_never_index");
if (!existsSync(neverIndex)) {
  writeFileSync(neverIndex, "");
  console.log("[make-dmg] restored target/.metadata_never_index");
}

const mb = (statSync(dmgPath).size / 1024 / 1024).toFixed(1);

// Clean tauri's intermediate rw.*.dmg shadow files — they mount as stray
// "dmg.XXXX" volumes during Spotlight indexing and show up as duplicate apps.
for (const f of readdirSync(path.join(tauriDir, "target/release/bundle/macos"))) {
  if (f.startsWith("rw.") && f.endsWith(".dmg")) {
    try {
      execSync(`hdiutil detach "/Volumes/${f}" -quiet 2>/dev/null || true`, { shell: "/bin/zsh" });
    } catch { /* ignore */ }
    rmSync(path.join(tauriDir, "target/release/bundle/macos", f), { force: true });
    console.log("[make-dmg] cleaned intermediate:", f);
  }
}

console.log(`[make-dmg] done → ${dmgPath} (${mb} MB)`);
