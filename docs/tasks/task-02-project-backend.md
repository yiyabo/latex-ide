# T-02：项目文件系统与持久化

> 阶段：M1 | 依赖：无（接口按 ARCHITECTURE §3/§4 先行） | 预计：4–6 天
> 目标：真实的用户、项目、文件、版本系统，替换 T-01 的全部 mock 数据源。

## 范围

1. **基础设施**
   - Prisma schema 按 ARCHITECTURE §4 实现 + migration；
   - 本地开发 docker-compose：PostgreSQL + MinIO + Redis；
   - Auth.js：credentials（email+密码）+ GitHub OAuth，会话 JWT。
2. **API 实现**（ARCHITECTURE §3 中除 /api/ai/* 和 /api/compile 之外的全部）
   - 项目 CRUD + 文件树；
   - 文件读/写/删/重命名（重命名=路径变更，需校验冲突）；
   - 二进制上传（图片，限 10MB，mime 白名单 png/jpg/pdf/svg/eps）；
   - 每次写文件创建 FileVersion，内容写对象存储；
   - 版本历史查询 + 回滚到指定版本（回滚=创建新版本，不删除历史）。
3. **项目模板**
   - "新建项目"内置 2 个模板：空白 article、带 sections/refs/figures 的论文骨架；
   - 模板文件存 `apps/web/server/templates/`，创建时拷贝入项目。
4. **自动保存**
   - 前端约定：编辑器防抖 2s 或 Cmd+S 触发 PUT files；本任务只需 API 支持幂等写入（带 clientVersion 乐观锁，冲突返回 409）。

## 安全要求

- 所有 handler 校验会话 + project.ownerId；
- path 规范化：拒绝 `..`、绝对路径、空路径、超过 255 字符；
- 上传文件魔数校验，不信任 client mime。

## 交付物

- 迁移可重放（`prisma migrate deploy` 从零建库成功）；
- API 集成测试（vitest + testcontainers 或独立测试库）覆盖所有端点的 200/401/403/404/409 路径；
- .env.example 与 README 本地启动说明。

## Definition of Done

- [ ] 注册/登录后可创建项目，两个模板均能编译前置完整（文件齐全）；
- [ ] 文件树、读写、重命名、删除、上传全部通过 API 测试；
- [ ] 写文件产生 FileVersion，可列出版本并回滚，历史不丢失；
- [ ] 越权访问他人项目返回 403/404；
- [ ] 路径穿越用例（`../../etc/passwd` 等）全部 400；
- [ ] 并发写同一文件触发 409 而非互相覆盖；
- [ ] 未登录访问任何 /api/projects/* 返回 401。

## 给执行 Agent 的提示

- 对象存储 key 格式：`projects/{projectId}/{path}#{versionId}`，避免特殊字符问题先做 URL-safe 编码；
- FileVersion 创建与文件元数据更新放同一事务；
- 删除项目走软删除还是硬删除：硬删除，但先异步清理对象存储。
