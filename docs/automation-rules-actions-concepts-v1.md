# 自动化、规则与 Action 的概念关系及扩展边界

更新日期：2026-10-12

## 核心结论

[Palantir 文档依据] Automate 把**条件**与条件满足后执行的**效果**组合成自动化。条件可基于时间、Ontology 中的对象数据，或两者结合；效果可包括提交 Action、执行函数和发送通知。参见 [Automate 概览](https://www.palantir.com/docs/foundry/automate/overview)。

[项目代码依据] 本项目当前的一条自动化指定目标对象类型、触发条件和一种效果。触发条件可以是内联表达式，也可以引用已发布的触发规则；效果可以是创建决策案例、创建人工核查请求，或执行明确允许自动化的 Action。参见 [自动化服务](../backend/src/modules/automation/automation-service.ts)。

[概念整理] 可以按以下顺序理解一次自动执行：

> 对象或其他信号出现 → 自动化检查触发条件 → 条件成立时产生效果 → 若效果是 Action，则由 Action 自身校验并执行写入。

[概念整理] **自动化负责“何时、针对谁、调用什么”；规则负责“如何判断或计算”；Action 负责“怎样受控地改变业务状态”。** 这是职责关系，不表示规则和 Action 的定义必须隶属于某条自动化。

## 三者在当前项目中的层次

| 概念 | 职责 | 与自动化的关系 | 代码依据 |
| --- | --- | --- | --- |
| [项目代码依据] 规则定义 `rule_def` | 提供受限 DSL 表达式；类型包括派生指标、约束、触发规则和评分归一化规则 | 自动化可引用其中的 `trigger` 规则，也可直接保存内联表达式；其他类型的规则服务于计算和决策 | [规则服务](../backend/src/modules/rules/rule-service.ts)、[数据库结构](../backend/src/db/migrations/001_init.sql) |
| [项目代码依据] Action 类型 `action_type` | 定义参数、前置条件、写入集合、审批策略及外部效果 | 可作为自动化的一种效果；也可由用户或决策案例独立调用 | [Action 服务](../backend/src/modules/actions/action-service.ts)、[决策案例页面](../frontend/src/pages/CaseDetailPage.tsx) |
| [项目代码依据] 自动化 `automation_rule` | 将触发对象、条件和一种效果组合起来，并记录执行结果 | 引用规则与 Action，但不拥有它们的定义 | [自动化服务](../backend/src/modules/automation/automation-service.ts)、[数据库结构](../backend/src/db/migrations/001_init.sql) |

[Palantir 文档依据] Palantir 的 Action type 本身定义对象、属性或链接如何变化，且包含提交时的副作用；Automate 可以把已定义的 Action 作为效果来调用。参见 [Action types 概览](https://www.palantir.com/docs/foundry/action-types/overview)和 [Automate 与 Ontology Manager 的集成](https://www.palantir.com/docs/foundry/automate/integrations)。

[项目代码依据] 当前项目中，自动执行 Action 还必须满足额外约束：Action 已发布、显式设置 `allowAutomation`、无审批或外部效果，且只更新触发对象。因此“自动化选择某个 Action”不等于绕过 Action 自身的约束。参见 [自动化服务](../backend/src/modules/automation/automation-service.ts)。

## Automate 的条件范围与本项目现状

| 条件 | Palantir Automate | 本项目当前实现 |
| --- | --- | --- |
| [官方文档／项目代码依据] 时间或日程 | 可在特定时间或按小时、日、周、月及 cron 日程触发。[时间条件](https://www.palantir.com/docs/foundry/automate/condition-time) | 未实现运行时调度。数据库字段注释预留 `schedule`，执行器目前只查询 `object_change`。[数据库结构](../backend/src/db/migrations/001_init.sql)、[自动化服务](../backend/src/modules/automation/automation-service.ts) |
| [官方文档／项目代码依据] 对象变化 | 可监控对象集合中对象的新增、修改或离开集合，也可指定观察的属性。[对象集合条件](https://www.palantir.com/docs/foundry/automate/condition-objects) | 已实现：对象创建或更新后，按对象类型和当前属性表达式检查。尚未实现对“进入集合”“离开集合”或特定属性变化的独立语义。[自动化服务](../backend/src/modules/automation/automation-service.ts) |
| [官方文档／项目代码依据] 定期处理对象集合 | 可按日程对一个对象集合内的全部对象运行效果。[对象集合条件](https://www.palantir.com/docs/foundry/automate/condition-objects) | 未实现对象集合批量调度。[自动化服务](../backend/src/modules/automation/automation-service.ts) |
| [官方文档／项目代码依据] 指标跨越阈值 | 可比较对象集合的指标，也可用返回布尔值的函数定义复杂判断。[对象集合条件](https://www.palantir.com/docs/foundry/automate/condition-objects) | 当前触发表达式只读取单个 `object` 的属性或 `now`；未实现集合聚合阈值触发。[自动化服务](../backend/src/modules/automation/automation-service.ts) |
| [官方文档／项目代码依据] 流数据到达 | 可监听流式数据集或流式对象。[流式条件](https://www.palantir.com/docs/foundry/automate/streaming) | 未实现流式条件。[自动化服务](../backend/src/modules/automation/automation-service.ts) |
| [官方文档／项目代码依据] 上游自动化完成 | 可在父自动化完成后触发下游自动化，并可叠加对象集合条件。[自动化依赖](https://www.palantir.com/docs/foundry/automate/automation-dependencies) | 未实现自动化间依赖。[自动化服务](../backend/src/modules/automation/automation-service.ts) |

[项目代码依据] 数据库 `trigger_type` 的注释列出 `object_change / schedule / event`，但这只是数据结构中的预留说明；当前执行器仅处理 `object_change`，不能据此认为日程或事件触发已经可用。参见 [数据库结构](../backend/src/db/migrations/001_init.sql)和 [自动化服务](../backend/src/modules/automation/automation-service.ts)。

## 未来增补时需要回答的问题

- [待考虑] 是否需要“对象进入／离开筛选集合”的状态转换语义？若需要，应明确如何比较变化前后的集合归属。
- [待考虑] 日程、对象集合阈值、流数据和上游自动化完成，哪些有实际业务场景？先按场景决定优先级，不把 Palantir 的能力清单直接当作本项目需求。
- [待考虑] 若支持多种触发来源，是否将当前 `automation_rule` 更名为“自动化定义”，并将“触发来源”“判断条件”“效果”在模型和界面中分开表达？
- [待考虑] 新触发方式如何处理幂等、重复执行、循环触发、失败重试、权限和人工审批？

## 后续维护

[维护约定] 后续讨论若澄清或改变自动化、规则、Action 的职责、触发条件或支持范围，应以最新版本为基础增补本主题文档。修改或删除已有内容时新建 `v2`、`v3` 等版本，并把 `AGENTS.md` 中的最新文档链接更新到新版本；新增内容对整体理解影响较大时也升级版本。每项新增主张应标明“官方文档依据”“项目代码依据”“待考虑”或“[猜测]”，并给出可核对的来源。
