# T-03：LaTeX 编译基础设施

> 阶段：M1 | 依赖：无（用本地假项目目录开发，T-02 完成后接线） | 预计：4–6 天
> 目标：安全、隔离、可观测的编译服务。**这是全系统安全优先级最高的模块。**

## 范围

1. **沙箱镜像**（`docker/texlive/Dockerfile`）
   - 基于 TeX Live 精简方案（scheme-small + 常用包集合：ctex, beamer 不需要，amsmath/graphicx/biblatex 等学术论文常用包）；
   - 非 root 用户 `tex`；镜像内无网络工具非必要不装。
2. **编译 Worker**（`workers/compile`，独立 Node 进程）
   - BullMQ 消费 `compile` 队列；
   - 每次任务：拉取项目文件到临时目录 → 启动一次性容器（`--network=none --memory=2g --cpus=2 --read-only`，挂载项目目录只读 + output 目录可写）→ `latexmk -pdf -interaction=nonstopmode -no-shell-escape -halt-on-error` → 收集 PDF 与日志 → 清理；
   - 硬超时 60s（容器层 + 应用层双保险）；超时/崩溃也要回收容器；
   - 并发上限可配（默认 2）。
3. **日志解析器**（`packages/latex`）
   - 解析 latexmk/TeX 日志 → LatexDiagnostic[]（file/line/severity/message）；
   - 测试样本：缺 } 、未定义命令、缺包、引用未定义、overfull hbox warning 各至少一例 fixture。
4. **API 接线**
   - POST /api/projects/[id]/compile：将项目当前文件快照到对象存储临时区并入队；
   - GET /api/compile/[jobId]：返回 CompileResult；另提供 SSE 端点推送状态（queued → running → done）；
   - PDF 产物存对象存储，GET 走短时预签名 URL。

## 明确不做

增量编译缓存、Synctex 正反向定位（M3 后再议）、多引擎自动探测。

## Definition of Done

- [ ] 模板项目（T-02 的论文骨架）编译成功产出 PDF，diagnostics 为空或仅 warning；
- [ ] 含错误文档（缺 `}`、`\undefinedcmd`）编译失败，diagnostics 含正确文件与行号（±1）；
- [ ] 超时用例（`\loop\repeat` 死循环）60s 内被终止，status=timeout，容器已回收；
- [ ] 恶意用例验证（必须全部失败且无宿主副作用）：
  - [ ] `\immediate\write18{...}`（shell escape）；
  - [ ] `\input{/etc/passwd}` 读取宿主机文件；
  - [ ] 文档内 `\url` 主动外联 / hyperref 编译期网络请求；
- [ ] 连续提交 10 个编译任务，队列有序执行，无容器泄漏（`docker ps` 干净）；
- [ ] 单元测试覆盖日志解析器全部 fixture；
- [ ] Worker 崩溃重启后不丢任务（BullMQ 持久化）。

## 给执行 Agent 的提示

- 宿主 Docker socket 挂载要限定 Worker 容器权限，评估 rootless docker 或 gVisor（可作后续增强，首版记录风险即可）；
- latexmk 退出码语义注意：`-halt-on-error` 下非 0 即失败，但 warning 不影响；
- 日志里文件名提取注意 LaTeX 的括号嵌套路径格式，用成熟解析逻辑而非裸正则硬凑。
