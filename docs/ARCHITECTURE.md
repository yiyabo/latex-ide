# 架构与跨任务契约

所有执行 Agent 开工前必读。本文件是任务间唯一的接口事实来源；任何修改需监督 Agent 批准。

## 1. 目录结构约定

```
latex-ide/
├── apps/
│   └── web/                  # Next.js 应用（前端 + API routes）
│       ├── app/              # App Router 页面与 route handlers
│       ├── components/       # UI 组件
│       ├── lib/              # 客户端工具、stores、hooks
│       └── server/           # 服务端逻辑（db、services）
├── packages/
│   ├── contracts/            # 本文件中所有类型的单一实现（zod + ts 类型）
│   └── latex/                # LaTeX 解析工具（选区上下文、日志解析）
├── workers/
│   └── compile/              # 编译 Worker（独立进程）
├── docker/
│   └── texlive/              # 编译沙箱镜像
└── docs/
```

`packages/contracts` 是唯一允许被所有方 import 的包。前后端、Worker 之间不直接共享其他代码。

## 2. 核心类型契约（packages/contracts 必须实现）

```ts
// ---- 选区上下文：编辑器 → AI 面板 / Agent ----
type EditorSelectionContext = {
  projectId: string;
  filePath: string;            // 项目内相对路径，如 "sections/intro.tex"
  selectionStart: number;      // 字符偏移
  selectionEnd: number;
  selectedText: string;
  surroundingText: string;     // 选区前后各 N 行（默认 20，可配）
  sectionPath: string[];       // 如 ["Introduction", "Background"]
  cursorLine: number;
  language: "tex" | "bib";
};

// ---- 编译 ----
type CompileRequest = {
  projectId: string;
  entryFile: string;           // 主 tex 文件
  engine?: "pdflatex" | "xelatex" | "lualatex"; // 默认 pdflatex
};

type LatexDiagnostic = {
  filePath?: string;
  line?: number;
  severity: "error" | "warning";
  message: string;
  raw?: string;                // 原始日志片段
};

type CompileResult = {
  jobId: string;
  status: "success" | "failed" | "timeout" | "cancelled";
  pdfUrl?: string;             // 预签名 URL 或受控静态路径
  diagnostics: LatexDiagnostic[];
  durationMs: number;
};

// ---- AI Patch：Agent 提议 → 用户确认 → 应用 ----
type PatchOperation = {
  type: "replace";
  filePath: string;
  start: number;               // 字符偏移
  end: number;
  expectedOldText: string;     // 冲突检测：应用前必须仍匹配
  newText: string;
};

type PatchProposal = {
  id: string;
  conversationId: string;
  summary: string;             // 给用户看的修改说明
  operations: PatchOperation[];
  baseVersionId: string;       // 基于哪个文件版本生成
  status: "pending" | "accepted" | "rejected" | "conflict" | "applied";
};

// ---- AI 对话 ----
type ConversationMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  patchProposalId?: string;
};
```

## 3. API 契约（Route Handlers，均要求登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/projects` | 项目列表 / 创建 |
| GET/PATCH/DELETE | `/api/projects/[id]` | 项目详情 / 重命名 / 删除 |
| GET | `/api/projects/[id]/tree` | 文件树 |
| GET/PUT/DELETE | `/api/projects/[id]/files?path=` | 读 / 写（创建版本）/ 删 |
| POST | `/api/projects/[id]/files/upload` | 图片等二进制上传 |
| POST | `/api/projects/[id]/compile` | 入队编译，返回 jobId |
| GET | `/api/compile/[jobId]` | 轮询 CompileResult（或 SSE 推送） |
| POST | `/api/ai/chat` | SSE 流式对话，body 含 EditorSelectionContext |
| POST | `/api/ai/patches/[id]/accept` | 校验 expectedOldText 后应用，冲突返回 409 |
| POST | `/api/ai/patches/[id]/reject` | 拒绝 |

文件写入与 patch 应用是仅有的两个写文件入口，都必须创建 FileVersion 记录。

## 4. 数据模型（Prisma，T-02 负责实现）

```
User(id, email, name, passwordHash?, createdAt)
Account / Session            # Auth.js 标准表
Project(id, ownerId, name, entryFile, engine, createdAt, updatedAt)
ProjectFile(projectId, path, isBinary, size, updatedAt)  # 复合主键 (projectId, path)
FileVersion(id, projectId, path, contentHash, storageKey, createdBy, createdAt)
CompileJob(id, projectId, entryFile, engine, status, diagnostics Json, pdfKey?, durationMs, createdAt)
Conversation(id, projectId, title, createdAt)
Message(id, conversationId, role, content, createdAt)
PatchProposal(id, messageId, summary, operations Json, baseVersionId, status, createdAt)
```

文件内容存对象存储（`storageKey`），数据库只存元数据。最新版本内容可缓存于 DB 以加速读取，但版本历史一律在对象存储。

## 5. AI Agent 工具协议（T-04 实现，模型可见的工具集）

首版工具（模型只能通过这些工具行动，不得直接写文件）：

| 工具 | 输入 | 说明 |
|---|---|---|
| `read_selection` | — | 返回当前 EditorSelectionContext |
| `read_file_range` | path, startLine, endLine | 读文件片段 |
| `search_project` | query, fileGlob? | 全文检索 label/cite/术语 |
| `read_bibliography` | citeKeys[] | 读 .bib 条目 |
| `get_compile_errors` | — | 最近一次 CompileResult.diagnostics |
| `propose_patch` | summary, operations[] | 生成 PatchProposal（仅此一个写路径，且不真正写入） |
| `compile_project` | — | 触发编译并返回结果 |

## 6. 编译沙箱硬性要求（T-03）

- 每次编译独立临时目录 + 独立容器；
- `--network=none`、内存 ≤ 2GB、CPU ≤ 2 核、执行 ≤ 60s、磁盘 ≤ 500MB；
- `latexmk -pdf -interaction=nonstopmode -no-shell-escape`（xelatex/lualatex 对应参数）；
- 容器内以非 root 用户运行；宿主机挂载只读项目副本 + 可写输出目录；
- 日志经 `packages/latex` 的解析器输出 LatexDiagnostic[]，原始日志保留供调试。

## 7. 前端状态与事件约定（T-01）

- Zustand store 至少包含：`currentProject`、`openFiles`、`activeFile`、`selection` (EditorSelectionContext | null)、`compileStatus`、`pendingPatches`。
- 编辑器选区变化防抖 300ms 后更新 `selection`，AI 面板订阅展示。
- patch 接受后由编辑器精确替换选区，不得整文重载；随后调用文件保存 API 创建版本。

## 8. 安全基线（所有任务共同遵守）

- 所有 API 校验会话与项目归属；
- 文件路径必须规范化并限制在项目根内（防路径穿越）；
- AI patch 应用前必须校验 `expectedOldText` 与 `baseVersionId`；
- 模型输出不可直接进 LaTeX 编译而不经用户确认（prompt injection 防线）；
- 不在日志、URL、客户端暴露对象存储密钥与模型 API key。
