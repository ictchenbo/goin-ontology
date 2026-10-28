# 城市燃气安全演示领域 v1

## 目标

新增一个独立的“城市燃气安全”应用领域，用一条可重复导入的合成数据把以下模块串成一条完整演示链路：

本体模型 → 对象浏览 → 决策工作台（评分/硬约束/记录决策）→ 审批中心 → 动作执行 → 对象状态回写。

领域之间保持隔离：燃气类型的对象、关系、决策类型、Action、案例和审计记录都写入独立领域，不影响现有“公共安全 / 战场态势 / 政治安全”领域。

## 场景故事

某市城东区梧桐路与建设路交口的 DN300 中压燃气管段发生泄漏：

- SCADA 监测终端 PT-031 显示压力由 138 kPa 降至 96 kPa；
- 巡检员携带便携检测仪测得 18% LEL，两处井盖有异味，现场已核实；
- 管段上游有可远程操作的调压站阀门 VALVE-WT-01，影响 320 户居民；
- 管段 120 米外是梧桐路小学（860 人），210 米外是社区医院（140 人）。

决策人需要在“继续监测、派发核实、关阀隔离、全城停气”之间作出选择；审批人按职责分离批准后，执行人关闭阀门并生成抢修工单。

另有一条辅线“建设路餐饮街燃气异味报警”：仅有 12345 单一来源、尚未核实，用于演示审批中心的待办事项与“未核实不得隔离”的硬约束。

## 领域与账号

| 项目 | 值 |
| --- | --- |
| 领域标识 | `urban-gas-safety` |
| 领域名称 | 城市燃气安全 |
| 成员 | 现有全部启用用户（与初始领域一致，便于切换角色演示） |

推荐演示账号（密码见 README）：

| 账号 | 角色 | 演示职责 |
| --- | --- | --- |
| `analyst` | analyst | 评分、记录决策、提交审批 |
| `safety` | safety_officer / approver | 审批中心批准或驳回 |
| `operator` | operator | 执行已批准动作 |
| `commander` | commander / approver | 可替换 analyst + safety + operator 的合并演示 |
| `admin` | admin | 领域成员管理、全流程兜底 |

## 本体模型

### 对象类型（7）

| 类型 | 说明 |
| --- | --- |
| `GasLeakAlarm` | 泄漏报警事件，决策案例触发对象 |
| `GasSensor` | SCADA 监测终端 |
| `GasPipeline` | 燃气管段，隔离动作作用对象 |
| `GasValveStation` | 上游阀门站 |
| `GasSensitiveSite` | 学校/医院/市场等敏感场所 |
| `GasRepairTeam` | 抢修/巡检班组 |
| `GasWorkOrder` | Action 执行后生成的处置工单 |

### 关系（6）

`gas_alarm_monitored_by`（报警→终端）、`gas_sensor_on_pipeline`（终端→管段）、`gas_pipeline_has_valve`（管段→阀门）、`gas_pipeline_near_site`（管段→敏感场所）、`gas_team_responsible_for`（班组→管段）、`gas_workorder_for_alarm`（工单→报警）。

### 规则（3 条触发 + 1 个派生指标）

| 规则 | 类型 | 作用 |
| --- | --- | --- |
| `gas_methane_threshold` | trigger | 甲烷浓度 ≥ 10% LEL 提示核查 |
| `gas_pressure_drop_alert` | trigger | 压力下降 ≥ 30 kPa 提示泄漏嫌疑 |
| `gas_single_source_alert` | trigger | 单源报警提示补充核实 |
| `gas_urgency_index` | derived_metric | 浓度与压降折算 0-100 紧急度 |

### 函数（1）

`gas_response_priority(methane_pct, pressure_drop)`：按 `clamp(methane_pct * 4 + pressure_drop, 0, 100)` 计算响应优先级，可在模型工作台试算。

### Action（3）

| Action | 必填参数 | 写回 |
| --- | --- | --- |
| `gas_record_observation` | objectId, note | 报警记录监测状态与观察结论 |
| `gas_dispatch_inspection` | objectId, teamId, reason | 创建工单并关联报警，更新报警为核实中 |
| `gas_isolate_valve` | objectId, pipelineId, valveId, reason | 创建抢修工单并关联报警，管段置为已隔离、阀门置为已关闭 |

三个 Action 都要求审批角色（safety_officer / commander）在案例已批准后才能执行。

### 决策类型（1）

`gas_leak_response`：目标对象 `GasLeakAlarm`，必需事实 `alarmTime`、`verificationStatus`。

- 评分：安全收益 40、处置时效 25、影响可控 20、程序合规 15；
- 硬约束：未核实报警不得隔离/停气；停气或疏散须有有效应急授权；
- 软约束：单次影响超过 500 户、到场超过 30 分钟、单一来源报警；
- 角色矩阵：提案 `analyst/commander/safety_officer/admin`，审批 `safety_officer/commander/admin`，执行 `operator/commander/admin`。

## 演示数据与两条案例

### 主线案例：梧桐路中压管段燃气泄漏应急处置

- 状态停在 `OptionsReady`，4 个方案，未预评分；
- 方案：继续监测 / 派发抢修核实 / 关阀隔离 / 全城停气；
- “全城停气”因缺少授权触发硬约束而不可行，用于展示不可选原因；
- 预期最优方案为“关闭上游阀门隔离管段”。

### 辅线案例：建设路餐饮街燃气异味核实处置

- 已评分、已记录决策并提交审批，状态为 `PendingApproval`；
- 已选“派发巡检班组核实”，审批中心可直接看到待办；
- 若改选“关闭支线阀门隔离”，会因报警未核实而不可行。

### 对象与证据

两条报警链各有：报警、监测终端、管段、阀门、敏感场所、班组；主线另有历史工单。证据来自 SCADA 日志、巡检记录和 12345 热线（均标明为合成演示数据）。报警时间按导入时刻相对生成，保证 30 天快照新鲜度。

## 演示步骤

1. 以 `admin` 或任意账号登录，选择“城市燃气安全”领域。
2. 本体模型：查看对象类型、关系、规则、函数、Action 与决策类型（`gas_leak_response`），说明领域隔离。
3. 对象浏览：打开“梧桐路与建设路交口燃气泄漏报警”，查看管段、阀门、小学、医院、班组与证据链。
4. 决策工作台：进入“梧桐路中压管段燃气泄漏应急处置”：
   - 在“方案与评估”运行评分，观察可行性与不可行原因；
   - 选择“关闭上游阀门隔离管段”，填写理由后“记录决策”；
   - 在“决策与审批”点击“提交审批”。
5. 切换 `safety`（或 `commander`）登录：
   - 审批中心可见两条待办：主线和辅线；
   - 先批准“建设路餐饮街燃气异味核实处置”，再批准“梧桐路中压管段燃气泄漏应急处置”。
6. 切换 `operator`（或 `commander`）登录：
   - 打开主线案例，在“执行动作”执行 `gas_isolate_valve`；
   - 回到对象浏览确认管段 `isolated`、阀门 `closed`，并看到新生成的抢修工单与“工单对应报警”关系。
7. 动作执行页可查看 Action 运行记录；对象历史与审计记录可用于说明可追溯性。
8. 可选：辅线案例审批通过后执行“派发巡检班组核实”，同样会在对象页生成工单。

## 导入与重置

在 `backend` 目录执行：

```bash
npm run seed:urban-gas-demo -- --dry-run   # 预演并在结束时回滚
npm run seed:urban-gas-demo                # 写入开发库
```

脚本可重复运行：

- 领域、成员、类型、关系、对象、证据、案例均按业务键查重；
- Action 定义未变化时不升版本，已有审批不会因重复导入失效；
- 已有未终态案例会复用，不会重复创建；
- 如需完全重置演示，可清空该领域数据或使用全新数据库后重新导入。

## 验证

```bash
cd backend
npx tsx --test tests/urban-gas-demo.test.ts
```

测试覆盖：领域模型与对象齐备、两条案例初始状态、主线“评分→决策→审批→执行→对象回写”闭环、辅线“审批→执行→工单生成”闭环。

## 边界

- 全部数据为合成演示数据，外部 SCADA、热线与应急指挥系统未接入；
- Action 只写内部对象与审计，不发送外部通知；如需演示 Outbox，可在 Action 上增加 `externalEffects` 并配置 `OUTBOX_TARGETS_JSON`；
- 领域技术键仍为全局唯一，新增其他领域时不得复用 `Gas*` 类型键或 `gas_*` 规则/Action 键。
