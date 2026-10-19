# Ontology OODA 决策平台

以**本体模型**为中心的数据—逻辑—决策一体化平台，支持 OODA（Observe → Orient → Decide → Act）决策闭环。三个领域场景（供应链 / 军事训练想定 / 公共安全）通过**纯配置**接入同一内核，无需修改引擎代码。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | TypeScript + React 18 + Vite + Tailwind CSS（shadcn 风格组件）+ Lucide + 暗色模式 |
| 后端 | Node.js 20 + TypeScript + Express 4 + zod |
| 数据库 | SQLite（better-sqlite3，WAL 模式） |
| 部署 | Docker Compose + 一键启停脚本 |

## 快速开始

### 1. 本机 Docker（推荐）

```bash
# 默认端口 3000（后端）/ 18000（前端）
./scripts/start.sh --build

# 端口冲突时覆盖
BACKEND_PORT=13000 FRONTEND_PORT=18001 ./scripts/start.sh --build

# 停止
./scripts/stop.sh
```

或直接：

```bash
BACKEND_PORT=13000 FRONTEND_PORT=18001 docker compose up -d --build
```

- 前端：http://localhost:18000（或你指定的 FRONTEND_PORT）
- 后端健康检查：http://localhost:3000/api/health

### 2. 本地开发

```bash
# 后端
cd backend && npm install && npm run seed && npm run dev

# 前端（另开终端）
cd frontend && npm install && npm run dev
```

前端默认 `http://localhost:18000`，API 自动代理到 `http://localhost:3000`。

### 演示账号

| 用户名 | 密码 | 角色 |
|---|---|---|
| admin | admin123 | 管理员 |
| analyst | analyst123 | 分析师 |
| approver | approver123 | 审批人 |
| operator | operator123 | 执行人 |
| observer | observer123 | 观察员 |
| intel | intel123 | 情报员 |
| commander | commander123 | 指挥员 |
| safety | safety123 | 安全官 |
| legal | legal123 | 法务 |

> 以上为开发种子账号，生产环境务必修改密码与 JWT_SECRET。

## 验收清单对照

| 验收项 | 实现位置 |
|---|---|
| 案例含多对象 / ≥3 硬约束 / ≥3 准则 / ≥3 方案 | `backend/src/seed/scenario-configs.ts` 三场景配置 |
| 回放已完成案例 | `/cases/:id` + snapshot 快照机制 |
| 推演不污染正式对象 | `scenario-service.assertNoOverlayLeak` |
| 修订冲突恢复 | `object-service.updateObject` revision compare |
| 审批失效（事实变更） | `decision-service.invalidateApprovals` |
| 外部失败重试 | Outbox `retry` / `deliver` |
| 重复请求幂等 | `idempotencyGuard` + `idempotency_record` |
| 事实缺失标记 | 评分前置 facts completeness check |
| 权限测试 | `auth-service`：角色 / 密级阶梯 / 字段脱敏 |
| E2E 导入→定向→对比→审批→执行→复盘 | 见下方"验收用例" |
| 暗色 / 移动端 / 键盘 / 无障碍 | Layout 响应式 + `:focus-visible` + aria |
| 迁移 / 备份 / Linux 脚本 / 健康检查 | `migrations/` + 下文备份说明 + `scripts/` + `/api/health` |
| 军事与公共安全仅配置接入 | `scenario-configs.ts` 两个 pack |

## 验收用例（E2E）

```bash
# 1. 登录
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)

# 2. 导入数据（rows 数组 或 csv 文本 + mapping）
curl -s -X POST localhost:3000/api/ingest/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sourceType":"csv","filename":"demo",
       "csv":"code,name,status\nSUP-001,华东供应,qualified",
       "mapping":{"typeKey":"Supplier","fieldMap":{"code":"code","name":"name","status":"status"},"matchKeys":["code"]}}'
# 提交后调用 apply 落库
curl -s -X POST localhost:3000/api/ingest/jobs/$JOB_ID/apply \
  -H "Authorization: Bearer $TOKEN"

# 3. 创建案例 → Orient → 添加方案 → 评分
curl -s -X POST localhost:3000/api/cases \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"演示案例","decisionTypeKey":"sc_disruption_response","summary":"演示：港口拥堵延迟处置"}'
# 使用返回的 caseId 继续：
curl -s -X POST localhost:3000/api/cases/$CASE_ID/orient \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"depth":5,"maxAgeDays":30}'

# 4. 决策 → 审批 → 执行
curl -s -X POST localhost:3000/api/cases/$CASE_ID/decision \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"selectedAlternativeId":"ALT_ID","rationale":"综合得分最高"}'
curl -s -X POST localhost:3000/api/cases/$CASE_ID/approvals \
  -H "Authorization: Bearer $TOKEN"
curl -s -X POST localhost:3000/api/approvals/$APPROVAL_ID/decide \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"decision":"approved","comment":"同意"}'

# 5. 记录结果与复盘
curl -s -X POST localhost:3000/api/cases/$CASE_ID/outcomes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"expected":{"service":80},"actual":{"service":75},"notes":"接近预期"}'
```

## 数据库迁移

```bash
cd backend
npm run migrate
```

迁移文件：`backend/src/db/migrations/*.sql`，按文件名顺序执行，记录于 `schema_migrations`。

## 备份与恢复

SQLite 数据文件位置：

- Docker：命名卷 `ooda-data` → 容器内 `/data/ontology.db`
- 本地开发：`backend/data/ontology.db`

```bash
# 备份（Docker）
docker exec ontology-ooda-api sh -c 'sqlite3 /data/ontology.db ".backup /data/backup.db"' 
docker cp ontology-ooda-api:/data/backup.db ./backup-$(date +%Y%m%d).db

# 或直接复制卷
docker run --rm -v ooda-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/ooda-data-$(date +%Y%m%d).tar.gz -C /data .

# 恢复
docker cp ./backup.db ontology-ooda-api:/data/ontology.db
docker restart ontology-ooda-api
```

## 健康检查

| 端点 | 说明 |
|---|---|
| `GET /api/health` | 后端健康状态 + 迁移计数 |
| `GET /healthz` | 轻量探活 |
| `GET /healthz`（前端容器） | Nginx 静态托管探活 |

## 目录结构

```
├── backend/
│   ├── src/
│   │   ├── db/           # 数据库、迁移
│   │   ├── modules/      # ontology/objects/decision/scenario/actions/outcomes/ingestion/audit/auth
│   │   ├── routes/       # REST API + 中间件（JWT、幂等、错误处理）
│   │   ├── seed/         # 三场景配置与种子数据
│   │   └── shared/       # 规则 DSL、错误类型
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/   # UI 组件、布局
│   │   ├── pages/        # 仪表盘/本体/对象/案例/审批/动作/导入/审计
│   │   └── lib/          # API 客户端、鉴权、工具
│   ├── Dockerfile
│   └── nginx.conf
├── scripts/
│   ├── start.sh          # 一键启动
│   └── stop.sh           # 一键停止
├── docs/
│   └── foundry-ontology-ooda-reproduction-plan-v2.html
└── docker-compose.yml
```

## 配置说明

后端可调配置：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATABASE_PATH` | `./data/ontology.db` | SQLite 路径 |
| `JWT_SECRET` | 开发默认值 | **生产必改** |
| `SEED_ON_BOOT` | `0` | 设为 `1` 时空库自动写种子数据 |

## 安全说明

- 密码使用 bcrypt 哈希存储
- JWT 默认密钥仅供开发，生产环境通过 `JWT_SECRET` 注入
- 字段级脱敏（PII/SOURCE/LEGAL）按密级阶梯执行
- 演示账号密码写在种子数据中，生产部署前必须更换
