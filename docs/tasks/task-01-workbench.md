# T-01：前端工作台（可交互原型）

> 阶段：M0 | 依赖：无 | 预计：3–5 天
> 目标：不接真实后端，用 mock 数据验证三栏布局、编辑器选区联动、AI 面板交互闭环。

## 范围

在 `apps/web` 内实现 `/project/[id]` 工作台页面：

1. **三栏布局**（react-resizable-panels）
   - 左：文件树（mock 数据：main.tex、sections/*.tex、refs.bib、figures/）；
   - 中：CodeMirror 6 编辑器 + PDF 预览（mock PDF 即可），可左右分栏/只显示编辑器/只显示预览；
   - 右：AI 面板（对话列表 + 输入框 + 快捷动作 + 选区上下文卡片 + diff 预览）。
   - 三栏均可拖拽调宽、可折叠；小屏（<1024px）退化为 tab 切换。
2. **编辑器**
   - LaTeX 语法高亮（@codemirror/legacy-modes 的 stex 或 @replit/codemirror-lang-latex）；
   - 选区变化 → 防抖 300ms → 生成 EditorSelectionContext（按 ARCHITECTURE §2）→ 写入 Zustand；
   - 行号、当前行高亮、基础快捷键（Cmd+S 模拟保存并 toast）。
3. **AI 面板**
   - 顶部展示当前选区上下文卡片（文件、行号、选中文本预览，可折叠）；
   - 快捷动作按钮：润色 / 扩写 / 压缩 / 修复 LaTeX / 翻译为学术英文；
   - 点击动作或自由输入 → mock 流式回复（setTimeout 逐字即可）→ 产出 mock PatchProposal；
   - diff 预览组件（红色删除/绿色新增，行内 diff）+ 接受 / 拒绝按钮；
   - 接受：编辑器精确替换选区（不重载文档）；拒绝：无任何变化。
4. **主题**：深色/浅色切换，CSS 变量定义在 globals.css。

## 明确不做

真实 API、真实编译、真实 AI 调用、路由守卫、多人协作、移动端精细适配。

## 交付物

- 可运行的 `pnpm dev`，访问 `/project/demo` 完整演示上述流程；
- mock 数据集中在 `apps/web/lib/mock/`，接口形状与 ARCHITECTURE §2 类型一致（从 packages/contracts import）；
- packages/contracts 的初版实现（zod schema + 类型导出）。

## Definition of Done（验收清单）

- [ ] 三栏可拖拽、可折叠，刷新后布局保持（localStorage）；
- [ ] 选中编辑器文本后 300ms 内右侧显示选区上下文（文件名+行号+内容）；
- [ ] 清空选区后上下文卡片消失或显示"未选中内容"；
- [ ] 任意快捷动作产出流式回复 + diff 预览；
- [ ] 接受 diff 后编辑器选区被正确替换且可 Cmd+Z 撤销；
- [ ] 拒绝后文档内容无任何变化；
- [ ] 中间栏可在 编辑/分栏/预览 三种模式切换；
- [ ] 深浅色主题无样式破损；
- [ ] 无 console error；TypeScript strict 通过；ESLint 通过。

## 给执行 Agent 的提示

- 先建 packages/contracts，类型即文档；
- mock AI 回复内置 3–5 个固定剧本（每个快捷动作一个），保证演示可重复；
- CodeMirror 替换用 `view.dispatch({changes: {from, to, insert}})`，保持撤销历史。
