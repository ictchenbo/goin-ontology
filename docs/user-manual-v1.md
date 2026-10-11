# Ontology OODA 决策平台 使用手册

**版本**：v1.0  
**适用对象**：业务分析师、审批人、执行人、系统管理员、领域操作员  
**最后更新**：2026-10-11

---

## 目录

1. [系统概述](#1-系统概述)
2. [快速开始](#2-快速开始)
3. [角色与权限](#3-角色与权限)
4. [界面模块详解](#4-界面模块详解)
5. [核心工作流：OODA 决策闭环](#5-核心工作流ooda-决策闭环)
6. [三大业务场景](#6-三大业务场景)
7. [数据管理](#7-数据管理)
8. [运维与故障排查](#8-运维与故障排查)
9. [常见问题](#9-常见问题)
10. [附录：API 速查](#10-附录api-速查)

---

## 1. 系统概述

### 1.1 平台定位

Ontology OODA 决策平台是一套**以本体模型为中心**的数据—逻辑—决策一体化系统。它将现实世界中的业务对象、关系、规则和决策流程统一建模，支持在结构化数据基础上完成 **Observe（观察）→ Orient（定向）→ Decide（决策）→ Act（执行）** 的完整闭环。

### 1.2 核心概念

| 概念 | 说明 |
|---|---|
| **本体类型（Ontology Type）** | 对业务实体的结构化定义，包含属性、类型、约束。例如「供应商」「库存批次」「情报报告」。 |
| **对象实例（Object Instance）** | 本体类型的具体数据记录。每个对象有唯一 ID、版本号和安全标签。 |
| **关联（Link）** | 对象之间的关系，如「供应商 → 供货 → 仓库」。 |
| **证据（Evidence）** | 支撑对象属性的数据来源记录，含来源、置信度、时间戳。 |
| **决策案例（Decision Case）** | 一次完整的决策工作单元，围绕某个触发事件展开。 |
| **备选方案（Alternative）** | 案例中可供选择的处置措施，每个方案带参数、预测指标。 |
| **硬约束（Hard Constraint）** | 必须满足的条件，不满足则方案不可行（如预算上限、法定授权）。 |
| **评分准则（Criterion）** | 方案比较的维度，带权重和归一化方式（如交期保障、成本、风险）。 |
| **情景推演（Scenario Overlay）** | 在内存中临时修改对象数据进行假设分析，**不污染正式数据**。 |
| **动作（Action）** | 决策通过后执行的写操作，带参数校验、前置条件、审批策略和幂等键。 |
| **Outbox** | 外部副作用消息队列，保证至少一次投递，失败可重试。 |

### 1.3 技术架构

```
┌─────────────────────────────────────────────┐
│                  前端 (React)                │
│  仪表盘 / 本体 / 对象 / 决策工作台 / 审批 / … │
└──────────────────┬──────────────────────────┘
                   │ HTTP + JWT
┌──────────────────▼──────────────────────────┐
│              后端 API (Express)              │
│  鉴权 · 校验 · 幂等 · 审计 · 错误处理        │
├─────────────────────────────────────────────┤
│  本体引擎 │ 决策引擎 │ 推演引擎 │ 动作引擎   │
├─────────────────────────────────────────────┤
│            规则 DSL（受限表达式）            │
├─────────────────────────────────────────────┤
│            SQLite (WAL 模式)                │
└─────────────────────────────────────────────┘
```

**技术栈**：TypeScript + React 18 + Vite + Tailwind CSS + Express 4 + better-sqlite3 + Docker Compose

---

## 2. 快速开始

### 2.1 系统要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Linux（推荐）/ Windows / macOS |
| Docker | 20.10+ |
| Docker Compose | 2.0+ |
| 磁盘空间 | ≥ 500 MB |
| 内存 | ≥ 1 GB |

### 2.2 一键启动（Linux）

```bash
# 进入项目目录
cd /path/to/v1-codex

# 构建并启动（默认端口：后端 3000 / 前端 18000）
./scripts/start.sh --build

# 端口被占用时指定其他端口
BACKEND_PORT=13000 FRONTEND_PORT=18001 ./scripts/start.sh --build
```

启动成功后输出：

```
启动完成：
  前端: http://localhost:18000
  后端: http://localhost:3000/api/health
  停止: ./scripts/stop.sh
```

### 2.3 手动启动（Docker Compose）

```bash
# 默认端口
docker compose up -d --build

# 指定端口
BACKEND_PORT=13000 FRONTEND_PORT=18001 docker compose up -d --build

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f backend
docker compose logs -f frontend
```

### 2.4 本地开发启动

```bash
# 终端 1：后端（端口 3000）
cd backend
npm install
npm run seed        # 首次：写入种子数据
npm run dev

# 终端 2：前端（端口 18000）
cd frontend
npm install
npm run dev
```

前端开发服务器会自动将 `/api` 请求代理到 `http://localhost:3000`。

### 2.5 访问系统

1. 打开浏览器访问 `http://localhost:<前端端口>`（默认 18000）
2. 使用演示账号登录（见 [3.2 演示账号](#32-演示账号)）
3. 进入仪表盘，开始使用

### 2.6 停止服务

```bash
# 仅停止容器（保留数据）
./scripts/stop.sh

# 停止并删除容器与网络（数据卷保留）
./scripts/stop.sh --down

# 彻底清理（含数据）
docker compose down -v
```

---

## 3. 角色与权限

### 3.1 角色说明

系统采用**基于角色的访问控制（RBAC）**，每个用户可拥有多个角色。部分数据受**密级阶梯**保护（PUBLIC < CONFIDENTIAL < SECRET < TOP_SECRET）。

| 角色 | 标识 | 主要权限 | 典型用户 |
|---|---|---|---|
| 系统管理员 | `admin` | 全部权限，包括类型发布、用户管理、审计查询 | 系统运维 |
| 业务分析师 | `analyst` | 创建案例、定向、添加方案、评分、记录决策、数据导入 | 业务分析人员 |
| 审批人 | `approver` | 审批/驳回决策请求 | 部门主管 |
| 执行人 | `operator` | 执行已审批的动作 | 操作员 |
| 观察员 | `observer` | 只读访问（部分字段脱敏） | 监察、审计 |
| 情报参谋 | `intelligence` | 军事情景：创建案例、评分、记录决策 | 情报分析 |
| 指挥员 | `commander` | 军事情景：审批、执行 | 指挥官 |
| 安全审查员 | `safety_officer` | 公共安全情景：审批、审计 | 安全官 |
| 法务审核 | `legal` | 公共安全情景：审批合法性审查 | 法律顾问 |

### 3.2 演示账号

> **安全警告**：以下为开发种子账号，**生产部署前必须修改密码和 JWT 密钥**。

| 用户名 | 密码 | 角色 | 密级 |
|---|---|---|---|
| `admin` | `admin123` | admin | TOP_SECRET |
| `analyst` | `analyst123` | analyst | CONFIDENTIAL |
| `approver` | `approver123` | approver | CONFIDENTIAL |
| `operator` | `operator123` | operator | PUBLIC |
| `observer` | `observer123` | observer | PUBLIC |
| `intel` | `intel123` | intelligence, analyst | SECRET |
| `commander` | `commander123` | commander, approver | SECRET |
| `safety` | `safety123` | safety_officer, approver | CONFIDENTIAL |
| `legal` | `legal123` | legal, approver | CONFIDENTIAL |

### 3.3 权限控制点

| 控制点 | 说明 |
|---|---|
| **接口鉴权** | 所有 `/api/*` 接口（登录除外）需 JWT 令牌 |
| **角色校验** | 动作执行需匹配 `requiredRoles`；审批需匹配决策类型的 `roleMatrix.approve` |
| **密级校验** | 读取对象时校验用户密级 ≥ 对象安全标签 |
| **字段脱敏** | PII 字段（证件号、住址、电话、线人身份等）按角色/密级脱敏显示 |
| **职责分离（SoD）** | 决策提议人不能批准自己的请求（admin 例外） |

### 3.4 登录与退出

1. 打开平台首页，进入登录页
2. 输入用户名和密码，点击「登录」
3. 右上角显示当前用户和角色标签
4. 点击右上角退出图标可退出登录

---

## 4. 界面模块详解

### 4.1 仪表盘（Dashboard）

**路径**：登录后默认首页

**功能**：
- **统计卡片**：对象实例数、决策案例数、待审批数、动作执行数
- **最近案例**：展示最近更新的案例列表，可快速进入详情
- 管理员提示：备份方法和系统配置入口

**操作**：点击任意统计卡片跳转到对应模块；点击案例行的「打开」进入案例详情。

### 4.2 本体模型（Ontology Studio）

**路径**：左侧导航「本体模型」（需 `admin` 或 `analyst` 角色）

**功能**：管理业务对象类型的定义、属性、版本发布与迁移预览。

#### 查看类型列表

左侧面板展示所有本体类型，包含：
- **标识**（typeKey）：如 `Supplier`、`InventoryLot`
- **名称**：中文显示名
- **分类**：如 core、supply-chain
- **版本**：当前发布版本状态

#### 查看类型详情

点击「详情」按钮，右侧面板展示：
- 当前版本的**属性定义**（字段名、类型、是否必填、枚举/范围约束）
- **发布新版本**按钮（修改后发布）
- **迁移预览**按钮（预览版本迁移影响）

#### 新建类型

1. 点击右上角「新建类型」
2. 填写类型标识（英文驼峰）、显示名称、分类、描述
3. 在「属性定义」中编写 JSON 数组，例如：

```json
[
  { "key": "name", "label": "名称", "type": "string", "required": true },
  { "key": "status", "label": "状态", "type": "string", "required": true },
  { "key": "score", "label": "评分", "type": "number", "min": 0, "max": 100 }
]
```

4. 点击「创建」

**属性类型支持**：`string`、`number`、`boolean`、`datetime`、`enum`（配合 `enum` 数组）

### 4.3 对象浏览（Object Explorer）

**路径**：左侧导航「对象浏览」

**功能**：检索、查看对象实例的属性、关联、证据和版本历史。

#### 检索对象

1. 在搜索框输入关键词（名称/编号）
2. 可按类型筛选
3. 按 Enter 或点击「检索」

#### 查看对象详情

点击任意对象行的「查看」，右侧面板展示：

| 区块 | 内容 |
|---|---|
| **属性** | 对象完整 payload（JSON 格式） |
| **关联** | 与该对象相连的其他对象（带关系类型标签） |
| **证据** | 支撑数据的来源记录（来源名、置信度、时间） |
| **版本历史** | 修订号、修改时间、操作人、变更原因 |

### 4.4 决策工作台（Case Desk）

**路径**：左侧导航「决策工作台」

这是平台的**核心模块**，完成 OODA 全流程。

#### 4.4.1 案例列表

- 按状态筛选：New / Observed / Oriented / OptionsReady / PendingApproval / Approved / Executing / Completed / Failed / OutcomeReviewed / Closed / Cancelled
- 点击「新建案例」创建新案例

#### 4.4.2 新建案例

1. 填写标题（必填）、描述
2. 选择**场景包**：供应链中断 / 军事训练想定 / 公共安全事件
3. 选择**决策类型**（决定评分准则和硬约束）
4. 点击「创建」

#### 4.4.3 案例详情页（OODA 流程）

案例详情页从上到下依次为：

**① 状态进度条**

展示案例在状态机中的位置：

```
New → Observed → Oriented → OptionsReady → PendingApproval
    → Approved → Executing → Completed → Closed
```

**② Observe / Orient · 态势构建**

- 点击「执行 Orient 快照」：抓取关联对象和证据的冻结快照
- 显示**事实完备性**标签（绿色「事实完备」/ 黄色「事实缺口」）
- 显示关联对象标签
- 事实变更后可点击「重新 Orient」

> **重要**：快照一旦生成即冻结，后续对象变更不会影响该案例的评分依据，保证决策可追溯。

**③ Decide · 方案备选**

- 列出所有备选方案
- 不可行方案标红「不可行」
- 可添加新方案（名称、说明、参数 JSON）

方案参数示例：

```json
{
  "serviceScore": 82,
  "cost": 12000,
  "riskScore": 40
}
```

**④ 评分对比**

- 点击「运行评分」执行评估
- 表格展示各方案**得分、可行性、不可行原因**
- 推荐方案标「推荐」徽章
- 可调整**准则权重**（如 service/cost/risk）后重新评分

**评分顺序**（固定）：
1. 事实完整性/新鲜度检查
2. 硬约束过滤（不满足 → 标记不可行并记录原因）
3. 级联指标预测
4. 加权归一化得分排序（可行方案优先）

**⑤ 情景推演（Overlay）**

- 输入覆盖 JSON，例如：
  ```json
  { "overrides": { "availableQty": 120 } }
  ```
- 点击「运行推演」
- **推演仅在内存中进行，不会修改正式对象数据**（由 `assertNoOverlayLeak` 保证）

**⑥ 决策与审批**

| 操作 | 说明 | 需要角色 |
|---|---|---|
| 记录决策 | 选定方案并填写理由 | analyst / commander / intelligence / admin |
| 提交审批 | 将决策推入审批流程 | 同上 |
| 批准 | 通过审批 | approver / commander / admin |
| 驳回 | 拒绝审批 | 同上 |
| 执行决策动作 | 执行已审批的动作 | operator / commander / admin |

### 4.5 审批中心（Approvals）

**路径**：左侧导航「审批中心」

**功能**：集中处理待审批事项。

**列表字段**：案例（可跳转）、方案、状态、提交时间、审批意见

**操作**：
1. 在「意见」输入框填写审批备注
2. 点击「批准」或「驳回」

**职责分离规则**：决策提议人不能批准自己的请求（admin 例外）。尝试自批会返回 403。

### 4.6 动作执行（Action Runs）

**路径**：左侧导航「动作执行」

**功能**：查看动作执行记录和 Outbox 外部消息。

#### 执行记录

展示每次动作执行的：动作类型、状态、关联案例、幂等键、开始时间、错误信息。

> **幂等保证**：使用相同幂等键重复提交时，系统返回首次执行结果，不会重复执行。

#### Outbox 消息

外部副作用（如通知仓库系统）通过 Outbox 异步投递：
- **状态**：pending / delivered / failed
- **重试**：失败消息可点击「重试」
- **批量投递**：点击「投递 Outbox 待发消息」

### 4.7 数据导入（Ingestion）

**路径**：左侧导航「数据导入」

**功能**：从 CSV/JSON 导入外部数据，创建或更新对象实例。

#### 新建导入任务

1. 填写**来源名称**（数据源标识）
2. 选择**目标类型**（如 Supplier、Facility）
3. 选择**格式**：CSV 或 JSON
4. 粘贴**数据内容**：

CSV 示例：
```
code,name,status
SUP-001,华东供应,qualified
SUP-002,西部供应,pending
```

JSON 示例：
```json
[
  { "code": "SUP-001", "name": "华东供应", "status": "qualified" },
  { "code": "SUP-002", "name": "西部供应", "status": "pending" }
]
```

5. 填写**字段映射 JSON**（源字段 → 目标属性）：

```json
{ "code": "code", "name": "name", "status": "status" }
```

6. 点击「提交导入」

提交后系统会**自动执行**导入（创建任务 + 落库），并显示「接受 N 行，拒绝 M 行」。

**匹配规则**：按 `matchKeys`（当前 UI 默认 `["code"]`）匹配已有对象进行更新；未匹配的创建新对象；校验失败的行进入**拒绝队列**。

### 4.8 审计日志（Audit）

**路径**：左侧导航「审计日志」（需 `admin` 或 `safety_officer`）

**功能**：检索所有操作痕迹。

- **筛选**：按用户名、动作类型
- **事件详情**：点击「详情」查看完整 JSON（含 correlationId 可追踪全链路）
- **覆盖范围**：所有写操作、决策、审批、执行均会记录

---

## 5. 核心工作流：OODA 决策闭环

### 5.1 完整流程

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ Observe │───▶│ Orient  │───▶│ Decide  │───▶│  Act    │
│ 导入数据 │    │ 构建态势 │    │ 评估决策 │    │ 执行动作 │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
                      │              │              │
                      ▼              ▼              ▼
                 事实校验       评分/推演       审批/审计
```

### 5.2 分步操作指南

#### 步骤 1：导入数据（Observe）

1. 进入「数据导入」页
2. 创建导入任务，将外部系统数据（CSV/JSON）导入为对象实例
3. 确认导入结果，查看拒绝队列

*或者*：使用种子数据中的已有对象直接开始。

#### 步骤 2：创建案例（Observe）

1. 进入「决策工作台」
2. 点击「新建案例」
3. 填写标题、描述、选择场景和决策类型
4. 创建成功后进入案例详情

#### 步骤 3：态势构建（Orient）

1. 在案例详情页点击「执行 Orient 快照」
2. 系统抓取关联对象、证据，冻结为快照
3. 检查**事实完备性**标签
4. 如有事实缺口，补充数据后点击「重新 Orient」

#### 步骤 4：添加备选方案（Decide）

1. 在「方案备选」区域添加 2-5 个方案
2. 填写方案参数（预测指标）
3. 系统自动计算硬约束符合性

#### 步骤 5：评分对比（Decide）

1. 点击「运行评分」
2. 查看得分排行和不可行原因
3. 如需调整权重，修改后重新评分
4. 可使用「情景推演」测试假设条件

#### 步骤 6：记录决策（Decide）

1. 在「决策与审批」区域选择最终方案
2. 填写决策理由
3. 点击「记录决策」
4. 点击「提交审批」

#### 步骤 7：审批（Act 前置）

1. 审批人进入「审批中心」
2. 查看决策详情，填写意见
3. 点击「批准」或「驳回」

#### 步骤 8：执行动作（Act）

1. 案例状态变为 `Approved`
2. 执行人点击「执行决策动作」
3. 系统校验参数、前置条件、审批有效性
4. 执行原子写集，发送 Outbox 消息

#### 步骤 9：记录结果（Outcome）

1. 执行完成后，记录实际结果
2. 对比预测与实际
3. 关闭案例

### 5.3 异常恢复

| 异常场景 | 系统行为 | 恢复方法 |
|---|---|---|
| **修订冲突** | 提交过期修订号返回 409 | 刷新对象最新版本后重新提交 |
| **审批失效** | 关键事实变更后审批标记失效 | 重新 Orient → 重新评分 → 重新提交审批 |
| **外部失败** | Outbox 消息标记 failed | 在「动作执行」页点击「重试」 |
| **重复请求** | 幂等键命中返回首次结果 | 无需处理，保证恰好一次执行 |
| **事实缺失** | 评分标记 `factsComplete: false` | 补充缺失字段数据后重新 Orient |

---

## 6. 三大业务场景

系统内置三个完整演示场景，共用同一决策引擎，仅配置不同。

### 6.1 供应链中断处置（supply-chain）

| 项目 | 内容 |
|---|---|
| **触发事件** | 货运延迟（SHP-7781）影响客户订单交期 |
| **决策类型** | `sc_disruption_response` |
| **评分准则** | 交期保障(50%) + 成本控制(30%) + 执行稳健(20%) |
| **硬约束** | 预算上限 ≤ $25,000；供应商资格 = qualified；容量可用 |
| **备选方案** | 跨仓调拨 / 加急运输 / 维持原计划 / 替代采购 |
| **角色矩阵** | 提议: analyst / 批准: approver / 执行: operator |

**预期结果**：跨仓调拨（得分 72.9）胜出；替代采购因供应商资格不满足被排除。

### 6.2 军事训练想定（military）

| 项目 | 内容 |
|---|---|
| **触发事件** | 两条矛盾情报报告（RPT-001 / RPT-002）需研判 |
| **决策类型** | `mil_threat_response` |
| **评分准则** | 任务完成度(40%) + 资源占用(25%) + 风险可控(35%) |
| **硬约束** | 法定授权存在；资源可用；情报完整性达标 |
| **备选方案** | 继续侦察核实 / 加强防护准备 / 请求协同支援 |
| **角色矩阵** | 提议: intelligence / 批准: commander / 执行: commander |

> **说明**：军事场景为合成训练数据，不含真实战术信息。

**预期结果**：加强防护准备胜出；继续侦察核实因情报缺口过大被排除；请求协同支援因缺少授权被排除。

### 6.3 公共安全事件（public-safety）

| 项目 | 内容 |
|---|---|
| **触发事件** | 虚构市民反映单一事件（EVT-2026-001），巡逻反证无异常 |
| **决策类型** | `ps_case_response` |
| **评分准则** | 处置适当性(40%) + 资源效率(25%) + 权利保障(35%) |
| **硬约束** | 未核实事件不能触发限制性措施；法定授权存在；用途限定 |
| **备选方案** | 继续观察 / 补充核实 / 转交专责部门 / 申请法定措施 |
| **角色矩阵** | 提议: safety_officer / 批准: safety_officer, legal / 执行: operator, legal |

**预期结果**：补充核实胜出；申请法定措施因未核实事件 + 缺少法定授权被排除。

---

## 7. 数据管理

### 7.1 备份

SQLite 数据文件位置：

| 部署方式 | 路径 |
|---|---|
| Docker | 命名卷 `ooda-data` → 容器内 `/data/ontology.db` |
| 本地开发 | `backend/data/ontology.db` |

**备份方法 1：直接复制卷**

```bash
docker run --rm -v ooda-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/ooda-data-$(date +%Y%m%d).tar.gz -C /data .
```

**备份方法 2：使用 SQLite 在线备份**

```bash
docker exec ontology-ooda-api sh -c \
  'sqlite3 /data/ontology.db ".backup /data/backup.db"'
docker cp ontology-ooda-api:/data/backup.db ./backup-$(date +%Y%m%d).db
```

### 7.2 恢复

```bash
# 方法 1：复制文件
docker cp ./backup.db ontology-ooda-api:/data/ontology.db
docker restart ontology-ooda-api

# 方法 2：从 tar 恢复
docker run --rm -v ooda-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/ooda-data-20261011.tar.gz -C /data
docker restart ontology-ooda-api
```

### 7.3 数据库迁移

```bash
cd backend
npm run migrate
```

- 迁移文件：`backend/src/db/migrations/*.sql`
- 按文件名顺序执行
- 已执行记录在 `schema_migrations` 表
- **迁移前务必备份**

### 7.4 种子数据

```bash
# 重置并写入演示数据
cd backend
rm -f data/ontology.db
npm run seed
```

种子数据包含：9 个用户、三场景完整对象图、样例决策案例。

### 7.5 配置项

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 后端监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATABASE_PATH` | `./data/ontology.db` | SQLite 路径 |
| `JWT_SECRET` | 开发默认值 | **生产必改** |
| `SEED_ON_BOOT` | `0` | 设为 `1` 时空库自动写种子数据 |
| `BACKEND_PORT` | `3000` | Docker 宿主机后端端口 |
| `FRONTEND_PORT` | `18000` | Docker 宿主机前端端口 |

---

## 8. 运维与故障排查

### 8.1 健康检查

| 端点 | 说明 |
|---|---|
| `GET /api/health` | 后端健康状态、迁移计数、版本 |
| `GET /healthz` | 轻量探活（返回 200） |
| 前端 `/healthz` | Nginx 静态托管探活 |

```bash
curl http://localhost:3000/api/health
# {"status":"ok","migrations":1,"time":"...","version":"1.0.0"}
```

### 8.2 日志查看

```bash
# 查看所有服务
docker compose logs -f

# 查看后端日志
docker compose logs -f backend

# 查看前端日志
docker compose logs -f frontend

# 查看最近 100 行
docker compose logs --tail=100 backend
```

### 8.3 常见故障

| 故障现象 | 可能原因 | 解决方法 |
|---|---|---|
| 启动报 `EADDRINUSE` | 端口被占用 | 更换端口：`BACKEND_PORT=13000` |
| 前端 502 | 后端未就绪 | `docker compose logs backend` 检查启动错误 |
| 登录返回 401 | 密码错误 | 使用演示账号（见 [3.2](#32-演示账号)） |
| 操作返回 403 | 角色权限不足 | 检查用户角色是否匹配（见 [3.1](#31-角色说明)） |
| 评分显示「事实缺口」 | 快照缺少必要事实 | 补充数据后重新 Orient |
| 动作执行返回「需要审批」 | 未通过审批流程 | 先提交审批并获得批准 |
| 决策提交返回 409 | 状态机不允许 | 检查案例当前状态（见 [5.1](#51-完整流程)） |
| SQLite `database is locked` | 并发写冲突 | WAL 模式已启用，重试即可；频繁出现则检查是否有残留进程 |
| 种子数据写入失败 | 库中已有数据 | `rm -f data/ontology.db` 后重新 seed |

### 8.4 数据一致性检查

```bash
# 验证推演不污染正式对象
# （或运行验收测试脚本）
API_BASE=http://localhost:13000 ./scripts/acceptance-test.sh
```

### 8.5 安全建议

1. **修改默认密码**：所有演示账号
2. **修改 JWT_SECRET**：设置强随机值
3. **启用 HTTPS**：生产环境使用反向代理（Nginx/Caddy）终止 TLS
4. **限制数据库访问**：SQLite 文件权限设为 `600`
5. **定期备份**：至少每日一次
6. **审计审查**：定期检查审计日志中的异常操作

---

## 9. 常见问题

### Q1：如何新增一个业务场景？

**A**：无需修改代码，只需配置：

1. 在 `backend/src/seed/scenario-configs.ts` 中添加新的 `ScenarioPack`
2. 定义对象类型（types）、关联（links）、动作类型（actionTypes）、决策类型（decisionTypes）
3. 可选：添加样例案例（sampleCase）和对象数据（objects）
4. 运行 `npm run seed` 重新初始化

### Q2：推演会影响真实数据吗？

**A**：**不会**。推演（Scenario Overlay）仅在内存中对数据叠加假设条件，执行 `assertNoOverlayLeak` 校验确认无泄漏。正式对象数据保持不变。

### Q3：为什么某个方案被标记为「不可行」？

**A**：方案未通过**硬约束**检查。在评分表格的「原因」列可以看到具体违反的约束（如「预算超限」「供应商资格不满足」）。不可行方案会保留在列表中，但不会被推荐。

### Q4：决策人能否批准自己的决策？

**A**：**不能**（职责分离）。提交审批后需由其他审批人（`approver`/`commander`/`safety_officer` 等）批准。admin 例外，可批准自己的请求。

### Q5：如何回放已完成的案例？

**A**：案例详情页展示完整的快照、方案、评分、决策记录。快照数据是冻结的，可追溯决策时的数据状态。

### Q6：如何处理外部系统的对接？

**A**：动作执行后，外部副作用写入 Outbox 队列，由 `POST /api/outbox/deliver` 触发投递。失败消息可重试。可配置外部系统 webhook 对接。

### Q7：如何调整评分权重？

**A**：在案例详情页的「评分对比」区域，修改权重值（如 service=50, cost=30, risk=20），点击「运行评分」重新计算。

### Q8：字段脱敏如何配置？

**A**：在 `backend/src/modules/auth/auth-service.ts` 的 `FIELD_POLICIES` 中定义敏感字段和对应策略。系统根据用户角色和密级自动脱敏。

---

## 10. 附录：API 速查

### 10.1 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/auth/me` | 获取当前用户信息 |

### 10.2 本体与对象

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ontology/types` | 类型列表 |
| GET | `/api/ontology/types/:typeKey` | 类型详情 |
| POST | `/api/ontology/types` | 新建类型 |
| POST | `/api/ontology/types/:typeKey/publish` | 发布版本 |
| GET | `/api/objects` | 对象检索 |
| GET | `/api/objects/:objectId` | 对象详情 |
| PATCH | `/api/objects/:objectId` | 更新对象 |
| DELETE | `/api/objects/:objectId` | 删除对象 |

### 10.3 决策案例

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/cases` | 案例列表 |
| POST | `/api/cases` | 创建案例 |
| GET | `/api/cases/:caseId` | 案例详情 |
| POST | `/api/cases/:caseId/transition` | 状态流转 |
| POST | `/api/cases/:caseId/orient` | 态势构建 |
| POST | `/api/cases/:caseId/alternatives` | 添加方案 |
| POST | `/api/cases/:caseId/score` | 运行评分 |
| POST | `/api/cases/:caseId/scenarios` | 运行推演 |
| POST | `/api/cases/:caseId/decision` | 记录决策 |
| POST | `/api/cases/:caseId/approvals` | 提交审批 |
| POST | `/api/cases/:caseId/invalidate-approvals` | 审批失效（事实变更） |
| POST | `/api/cases/:caseId/outcomes` | 记录结果 |
| POST | `/api/outcomes/:outcomeId/review` | 结果复盘（Completed→OutcomeReviewed） |
| POST | `/api/cases/:caseId/close` | 关闭案例 |
| GET | `/api/cases/:caseId/prediction-comparison` | 预测 vs 实际对比 |

### 10.4 审批与动作

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/approvals` | 审批列表 |
| POST | `/api/approvals/:id/decide` | 审批决定 |
| POST | `/api/actions/validate` | 动作校验预览（不执行） |
| POST | `/api/actions/execute` | 执行动作 |
| GET | `/api/actions/runs` | 执行记录 |
| GET | `/api/outbox` | Outbox 消息 |
| POST | `/api/outbox/deliver` | 触发投递 |
| POST | `/api/outbox/:id/retry` | 重试消息 |

### 10.5 数据与审计

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/ingest/jobs` | 创建导入任务 |
| GET | `/api/ingest/jobs` | 导入任务列表 |
| POST | `/api/ingest/jobs/:jobId/apply` | 导入落库 |
| GET | `/api/audit` | 审计日志 |
| GET | `/api/dashboard` | 仪表盘统计 |

### 10.6 请求示例

**登录**：
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

**评分**：
```bash
curl -X POST http://localhost:3000/api/cases/CASE_ID/score \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"scenarioRunId":"run-001","weights":{"service":50,"cost":30,"risk":20}}'
```

**执行动作**：
```bash
curl -X POST http://localhost:3000/api/actions/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "actionKey": "sc_transfer_inventory",
    "caseId": "CASE_ID",
    "alternativeId": "ALT_ID",
    "approvalId": "APR_ID",
    "params": { "objectId": "obj_1", "targetFacility": "WH-GZ", "quantity": 50, "costUsd": 1200 },
    "idempotencyKey": "unique-key-001"
  }'
```

---

## 版本历史

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-10-11 | 初始版本，覆盖全部功能模块 |

---

**技术支持**：请查看项目 `README.md` 或提交 Issue。  
**相关文档**：[实施方案](./foundry-ontology-ooda-reproduction-plan-v2.html)
