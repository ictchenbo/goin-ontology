# 本仓库本体模型维护约定

- 修改对象类型、属性、共享属性、Interface、Link、函数、规则、Action、自动化、决策类型或其运行实例之间的关系时，同步检查并更新 `frontend/public/ontology-concepts.svg`，使图中的概念、箭头和说明与实际代码保持一致。
- 更新关系图时，在本体模型管理页确认“查看概念关系图”可打开最新 SVG，并检查 SVG 能正常渲染。
- 讨论自动化、规则、Action 的职责、触发条件或支持范围时，核对并更新最新的 [概念与扩展边界文档](docs/automation-rules-actions-concepts-v1.md)；文档修改遵循版本号递增约定，并同步更新此链接。
- 讨论目标意图与本体对象、决策、方案、Action 或结果的关系时，核对并更新最新的 [目标意图建模文档](docs/goal-intent-modeling-v1.md)；文档修改遵循版本号递增约定，并同步更新此链接。
