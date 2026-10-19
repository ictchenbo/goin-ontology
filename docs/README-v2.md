# Ontology OODA 决策平台 · v2

[实现依据] 本版本按 `docs/foundry-ontology-ooda-reproduction-plan-v2.html` 的首版交付范围实现 Ontology、OODA 和三个合成场景。文档中的“范围边界”仍按非目标处理。

## 运行

[代码依据] `docker-compose.yml` 定义 Node.js 后端、React 前端和 SQLite 数据卷；默认前端端口 18000、后端端口 3000。Linux 使用 `scripts/start.sh --build` 启动，使用 `scripts/stop.sh` 停止。端口冲突时先设置 `BACKEND_PORT` 和 `FRONTEND_PORT` 环境变量。

[代码依据] 首次空库启动默认注入三个场景的合成数据和演示账号。账号见 `README.md`；正式环境应设置独立的 `JWT_SECRET` 并更换演示账号密码。

## 已接入的功能

[代码依据] 模型工作台支持类型、属性、接口、链接、规则、函数、Action 和自动化配置；模型版本可预览迁移、发布并以新版本回滚历史定义。对象页提供检索、关系、证据、历史和受控附件。

[代码依据] 决策工作台保存情境快照、证据引用、模型与规则版本、备选方案、隔离推演、硬约束与评分、决策理由、审批、执行、结果和回放 JSON。关键对象或证据变化会使旧批准失效。

[代码依据] CSV、JSON、人工表单和 Webhook 可进入来源区；Webhook 配置由 `WEBHOOK_SOURCES_JSON` 提供，格式为以来源键为索引的对象，每项包含 `secret` 和 `mapping`。请求须带 `X-Webhook-Secret` 与 `X-Delivery-Key`。重复投递键仅回放首次结果；同键不同内容返回冲突。

[代码依据] 附件默认保存在数据库同目录的 `attachments` 子目录，Docker 中位于 `/data/attachments`，单文件上限 10 MB。读取附件须拥有对应对象访问权限。

[代码依据] 外部动作副作用使用 Outbox。`OUTBOX_TARGETS_JSON` 将目标名映射到 HTTPS 地址；未配置目标会保持失败/待重试状态，不会被标记为已送达。目标服务应按发送的幂等键处理重复消息。

[代码依据] 可选 AI 适配器由 `AI_ADAPTER_URL`、`AI_ADAPTER_KEY` 配置。未配置时请求建议返回明确错误；配置后只保存候选解释、缺失事实或备选草案及自动检查与人工复核，不直接写正式对象。

## 验证、备份和恢复

[测试依据] `backend/npm test` 运行 19 项测试，其中 HTTP 验收覆盖导入到结果回放、Webhook 幂等、对象与案例权限、公共安全授权拦截、军事演训情报修订失效、自动化去重和 AI 建议人工纠正。前后端使用各自的 `npm run build` 检查构建。

[代码依据] `scripts/backup.sh` 使用 SQLite 在线备份 API 导出数据库，并连同附件打包。`scripts/restore.sh <backup.tar.gz>` 会先备份当前数据，再停机恢复并重新启动服务。恢复前应确认端口环境变量与部署时一致。

[代码依据] `GET /api/health` 返回迁移计数和服务状态；`GET /healthz` 提供容器探活。SQLite 迁移位于 `backend/src/db/migrations/`，启动时自动顺序执行。

## 外部配置边界

[代码依据] 三个样板使用合成数据；外部仓储、物流、指挥链或 LLM 端点需由部署方提供并配置。未配置时，应用的内部决策流程仍可运行，Outbox 会记录未交付的外部消息。
