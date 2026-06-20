# V121 页面职责矩阵

## 保留页面

| 页面 | 作用 | 数据来源 | 是否允许真实资金动作 |
|---|---|---|---|
| /v121/dashboard | 控制台 | health / worker / risk / opportunities | 否 |
| /v121/opportunities | 机会池 | latest_scan / scan API | 否 |
| /v121/intents | 执行意图 | order_intents | 否 |
| /v121/execution | 执行中心 | orderPlan / orderExecution | Dry-run 是，真实需 gate |
| /v121/mainnet-tiny | 安全门 | gate / preflight / settings | 否，仅展示 |
| /v121/positions | 持仓监控 | positions / account adapters | 否 |
| /v121/risk-center | 风控中心 | risk / kill-switch | 可切 Kill Switch |
| /v121/review | 复盘 | persistence | 否 |
| /v121/shadow | 只读诊断 | account adapters | 否 |
| /v121/settings | 参数中心 | settings / risk | 否 |

## 删除页面

| 页面 | 删除原因 |
|---|---|
| /dashboard | 旧入口，与 /v121/dashboard 冲突 |
| /funding | 旧看板，被 /v121/opportunities 替代 |
| /basis | 旧看板，被 /v121/opportunities 替代 |
| /alpha | 无关旧页面 |
| /strategy | 旧策略页，被 /v121/settings 替代 |
| /safety | 旧安全页，被 /v121/risk-center 替代 |
| /audit | 旧审计，被 /v121/review 替代 |
| /spread-opportunities | 旧价差页，被 /v121/opportunities 替代 |
| /production-console | 旧生产控制台 |
| /risk-center (旧) | 被 /v121/risk-center 替代 |
| /execution (旧) | 被 /v121/execution 替代 |
| /opportunities (旧) | 被 /v121/opportunities 替代 |
| /heatmap | 无关旧页面 |
| /factors | 无关旧页面 |
| /research | 无关旧页面 |
| /simulation | 旧模拟页，dev-only |
| /sandbox-lifecycle | 无关 |
| /account-sync | 无关 |
| /adl-monitor | 无关 |
| /api-keys | 已废弃 |
| /debug | 仅开发用 |
| /execution-queue | 被 /v121/execution 替代 |
| /history | 无关 |
| /local-feedback | 仅本地测试 |
| /local-test-guide | 仅本地测试 |
| /notifications | 未实现 |
| /notifications-center | 未实现 |
| /paper-portfolio | 旧的纸交易页 |
| /risk-rules | 旧风控规则 |
| /strategies | 旧策略页 |
| /testnet-readiness | 已废弃（无 TESTNET） |
