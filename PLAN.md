# AI LaTeX Agent IDE — 总体开发计划

> 版本：v1.0（2026-09-10）
> 角色分工：用户（产品决策）→ 监督 Agent（计划制定、任务验收、冲突仲裁）→ 执行 Agent（按任务简报开发）

## 1. 产品定位

面向科研人员的 AI LaTeX 写作工作台。先做 Web 版，桌面客户端后置。

核心闭环（一切开发围绕这条链路）：

```
编辑 LaTeX → 编译预览 → 选中文本 → AI 理解上下文并给建议
→ 用户审阅 diff → 确认后写回 → 重新编译
```

布局（类 Overleaf + AI Coding 工具）：

| 区域 | 功能 |
|---|---|
| 左侧：文件树 | `.tex` / `.bib` / 图片 / 模板；新建、重命名、删除、上传 |
| 中间：编辑 + 预览 | LaTeX 编辑器与 PDF 左右分栏；编译、错误定位、同步滚动 |
| 右侧：AI Agent 面板 | 对话、选区上下文、快捷动作、diff 建议、变更确认 |

## 2. 技术选型（已冻结，执行 Agent 不得擅自更改）

- **前端**：Next.js 14+ (App Router) + TypeScript strict
- **编辑器**：CodeMirror 6（选区监听、长文本、后续协作扩展）
- **面板布局**：react-resizable-panels
- **PDF 预览**：react-pdf (PDF.js)
- **状态管理**：Zustand
- **样式**：Tailwind CSS + CSS 变量设计令牌
- **后端**：Next.js Route Handlers（后续编译/Agent 服务可拆独立进程）
- **数据库**：PostgreSQL + Prisma
- **对象存储**：S3 兼容（开发用 MinIO）
- **队列**：Redis + BullMQ
- **认证**：Auth.js（credentials + GitHub OAuth）
- **LaTeX 编译**：独立 Worker 进程，Docker 沙箱，`latexmk` + TeX Live，`-no-shell-escape`
- **AI**：模型无关抽象层，首版支持 OpenAI / Anthropic 兼容接口

## 3. 里程碑

### M0 — 可交互原型（阶段 A）
不接真实后端，验证信息架构与选区联动体验。
对应任务：**T-01**

### M1 — 项目与编译闭环（阶段 B）
真实项目文件系统 + 沙箱编译 + PDF 预览 + 错误定位。
对应任务：**T-02, T-03**

### M2 — 选区驱动的 AI 写作助手（阶段 C）
选区上下文采集 → AI 对话 → diff 提议 → 接受/拒绝 → 写回。
对应任务：**T-04**

### M3 — 质量与发布准备
端到端测试、安全测试、性能与 UX 打磨。
对应任务：**T-05**

### M4 — 项目级 Agent（后续，不在本计划范围）
全局结构索引、跨文件一致性检查、多步骤任务审批流。

## 4. 任务拆分（可并行分配给不同执行 Agent）

| 编号 | 任务 | 依赖 | 简报 |
|---|---|---|---|
| T-01 | 前端工作台（三栏布局、编辑器、选区监听、模拟 AI 面板） | 无 | [task-01-workbench.md](docs/tasks/task-01-workbench.md) |
| T-02 | 项目文件系统与持久化（数据模型、API、存储） | 无（与 T-01 通过契约文件对齐） | [task-02-project-backend.md](docs/tasks/task-02-project-backend.md) |
| T-03 | LaTeX 编译基础设施（队列、沙箱、日志解析） | 无 | [task-03-compile-service.md](docs/tasks/task-03-compile-service.md) |
| T-04 | AI Agent 服务（上下文构建、工具协议、patch 机制） | T-01 的选区上下文类型 | [task-04-ai-agent.md](docs/tasks/task-04-ai-agent.md) |
| T-05 | UX 打磨与质量保障（E2E、安全、错误状态） | M2 完成后 | [task-05-ux-qa.md](docs/tasks/task-05-ux-qa.md) |

**跨任务契约**统一维护在 [ARCHITECTURE.md](docs/ARCHITECTURE.md)，所有执行 Agent 开工前必读。修改契约必须由监督 Agent 批准。

## 5. 不可妥协的产品约束

1. **AI 永不静默写入**：所有写入必须经 diff 展示 + 用户确认 + 版本记录。
2. **编译即执行不可信代码**：容器隔离、禁网络、`-no-shell-escape`、限 CPU/内存/时间/磁盘。
3. **最小上下文原则**：默认只发选区+周边上下文，项目级内容按需检索、用户可见。
4. **编辑器体验优先**：这是写作工具，不是聊天工具。
5. **为桌面端预留边界**：文件系统、编译、认证通过接口抽象，未来可替换为本地实现。

## 6. 首版成功标准（M2 验收）

新用户 10 分钟内完成：创建项目 → 编辑并编译 → 选中一段英文 → AI 润色 → 对比 diff → 接受 → 重新编译看到 PDF 更新 → 让 AI 定位并修复一个编译错误。

## 7. 工作流约定（监督模式）

1. 执行 Agent 领取任务前，先读 `PLAN.md` + `docs/ARCHITECTURE.md` + 自己的任务简报。
2. 每个任务完成 Definition of Done 后提交，附自测证据（测试输出 / 截图 / 演示）。
3. 监督 Agent 按简报中的验收标准逐条核对，不合格打回并注明具体条目。
4. 任务间接口冲突、契约变更、范围蔓延，一律上报监督 Agent 仲裁，不私下协商绕过。
5. 代码提交信息格式：`[T-0X] <type>: <描述>`。
