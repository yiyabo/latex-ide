# yiyabo

AI LaTeX Agent IDE — AI-assisted scientific writing workbench.

AI-assisted LaTeX writing workbench for researchers. Edit → compile → select → review AI diffs → accept → recompile.

## Quick start (local, no Docker required)

```bash
# 1. Install
pnpm install

# 2. Configure env
cp apps/web/.env.example apps/web/.env
cp .env.example .env   # optional for workers

# 3. Init database (SQLite) and seed demo user
cd apps/web
pnpm db:push
pnpm exec tsx prisma/seed.ts
cd ../..

# 4. Run
pnpm dev
# open http://localhost:3000
# login: demo@example.com / demo1234
```

## Architecture

See [PLAN.md](PLAN.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
apps/web          Next.js app (UI + API routes)
packages/contracts Shared zod types
packages/latex    Selection context + log parser
workers/compile   Compile worker (local latexmk or Docker sandbox)
docker/texlive    Sandboxed TeX Live image (production compile)
```

## Features (v1)

- Three-panel workbench: file tree · CodeMirror editor + PDF preview · AI panel
- Project CRUD with paper / blank templates
- File read/write with versioning (FileVersion + content-addressed storage)
- LaTeX compile via local latexmk or Docker sandbox (`-no-shell-escape`)
- Structured diagnostics from TeX logs
- Selection-driven AI assistant (mock provider by default)
- Patch proposals with diff review — **AI never writes silently**
- Auth: email/password (Auth.js credentials + optional GitHub OAuth)

## Environment

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | SQLite locally; use PostgreSQL in prod |
| `STORAGE_DRIVER` | `local` | `s3` for MinIO/S3 |
| `AI_PROVIDER` | `mock` | `openai` when `OPENAI_API_KEY` is set |
| `COMPILE_DRIVER` | `local` | `docker` for sandboxed builds |
| `QUEUE_DRIVER` | `local` | `bullmq` for external worker |

## Scripts

```bash
pnpm dev              # start web app
pnpm test             # run package tests
pnpm typecheck        # typecheck all packages
pnpm --filter @latex-ide/web db:push
```

## AI model configuration

Default is **mock** (offline demo). Configure a real model in two ways:

### 1. UI (recommended)

Open a project → AI panel → gear icon → choose provider:

| Provider | Base URL | Notes |
|---|---|---|
| OpenAI 兼容 | `https://api.openai.com/v1` | DeepSeek / Moonshot / OpenRouter / 自建网关均可 |
| Anthropic | `https://api.anthropic.com` | Messages API，流式 + tools |

API key is stored **server-side only** (DB `AiProviderConfig`), never returned to the browser.

### 2. Environment variables

```bash
AI_PROVIDER=openai          # or anthropic / mock
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
# or
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.anthropic.com
AI_MODEL=gpt-4o-mini
```

User-level settings override env; clear them in the settings dialog to fall back to env.

## Security notes

- Compile runs with `-no-shell-escape` and optional `--network=none` Docker isolation
- All file writes require auth + project ownership
- Paths are validated against traversal
- AI writes only through `PatchProposal` + user accept
- API keys stay server-side

## License

MIT
