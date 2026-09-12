# yiyabo — Desktop (Tauri)

Native macOS app: embeds the Next.js workbench as a local server and opens it in a Tauri window.

## Install (distribute)

1. Build on an Apple Silicon Mac (or adjust targets):

```bash
cd apps/desktop
pnpm tauri build
# or full pipeline:
pnpm build:app
```

2. Hand out:

```text
src-tauri/target/release/bundle/dmg/yiyabo_0.1.0_aarch64.dmg
```

3. User opens the DMG, drags **yiyabo.app** to Applications.

**Requirements on the user machine**

- macOS 10.15+
- **Node.js 20+** in PATH (the app launches `node` to run the embedded server)
- TeX Live / `latexmk` optional (for compile preview)

Data lives in the app local data dir (`~/Library/Application Support/com.yiyabo.desktop/`).

## Dev

```bash
# repo root
pnpm desktop
# or
DESKTOP_MODE=1 pnpm --filter @latex-ide/web dev
pnpm --filter @yiyabo/desktop tauri dev
```

## Layout

```
apps/desktop/
├── scripts/assemble-server.mjs   # copies next standalone → src-tauri/server-dist
└── src-tauri/
    ├── tauri.conf.json
    ├── icons/icon.icns
    ├── server-dist/              # embedded server (build artifact)
    └── src/lib.rs                # spawns node server on launch
```

## Signing / notarization (for public distribute)

Unsigned builds will show Gatekeeper warnings. For public release:

1. Apple Developer ID Application certificate
2. `codesign --deep --force --options runtime` (or Tauri signing config)
3. `xcrun notarytool submit ... --wait` then `xcrun stapler staple`

## Notes

- Desktop mode (`DESKTOP_MODE=1`) skips login and uses a single local user.
- First launch copies `yiyabo-template.db` into the app data directory.
- AI model can be configured in-app (gear icon); keys stay on device/server side of the local process.
