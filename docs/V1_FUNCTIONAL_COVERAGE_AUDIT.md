# V1 死代码功能覆盖率审计

> **审计日期**: 2025-06-29
> **范围**: `lib/` 下 V1 旧方案（258+ 源文件） vs `lib/strategy-v121/` 新方案（~111 源文件）
> **状态分类**:
> - ✅ v121 完全覆盖 — V1 可安全删除
> - ⚠️ 部分覆盖 — v121 有但不如 V1 全，需标记差异
> - ❌ v121 缺失 — V1 有但 v121 完全没有的功能
> - 🚫 已废弃 — v121 设计中有意识地移除/替代

---

## 总览

| 维度 | V1 旧方案 | v121 新方案 | 结论 |
|------|-----------|-------------|------|
| 交易所覆盖 | Binance / OKX / **Bybit** | binance / okx / **htx** | ⚠️ 部分覆盖 |
| 源文件数 | ~258 个（25+ 目录） | ~111 个（21 子模块） | ✅ |
| 核心架构 | 分离式模块 (connectors/exchanges/arbitrage) | 统一策略域 (domain/opportunity/execution) | ✅ |
| 持久化 | JSONL 文件（`data/` + `historyStore`） | JSONL + SQLite 双模式 | ✅ |
| 回测/仿真 | **独立 SimEngine + PaperTrader** | v121 内嵌 paperLifecycle | ⚠️ 部分覆盖 |

---

## 详细信息

### 1. 交易所对接

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| **交易所支持** | Binance / OKX / Bybit | binance / okx / htx | ⚠️ 部分覆盖 |
| 公有市场数据适配 | `exchanges/binanceAdapter` / `okxAdapter` / `bybitAdapter` | `market/adapters/BinancePublicAdapter` / `OkxPublicAdapter` / `HtxPublicAdapter` | ⚠️ 部分覆盖 |
| 私有账户适配 | `accountSync/adapters/` (Binance/Bybit/OKX mock) + `exchangeAdapters/` | `account/adapters/` (Binance/OKX/Htx) + `exchange-accounts/` runtime adapters | ⚠️ 部分覆盖 |
| 连接器层 (Connector) | `connectors/real/` (Binance/Bybit/OKX/Htx) + `connectors/mocks/` (+ Bitget/Gate/Hyperliquid) | 无独立 Connector 层，通过 account adapter + market adapter 直接调用 | ✅ 覆盖 |
| Bybit 交易所 | ✅ 有完整 RealBybitConnector + bybitAdapter | ❌ 无 Bybit 支持 | ❌ v121缺失 |
| HTX 交易所 | ✅ 有 RealHtxConnector | ✅ 有 HtxPublicAdapter + HtxAccountAdapter | ✅ v121覆盖 |
| Gate / Bitget / Hyperliquid mock | ✅ MockConnectors 有 | ❌ 无 | 🚫 废弃 |

**结论**: v121 将 Bybit 替换为 HTX，这是一次有意识的设计选择。Bybit 的缺失是设计意图，并非遗漏。但如果未来需要 Bybit，V1 代码不能直接删除。

### 2. 套利核心逻辑

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| 资金费率价差计算 | `fundingSpread/fundingSpreadEngine` — `getFundingRatesFromConnectors` / `calculateFundingSpread` / `findCrossExchangeFundingSpreads` | `market/fundingNormalize` + `opportunity/scanner` — `normalizeFunding8h` / `classifyFundingLevel` | ✅ v121覆盖 |
| 价差机会评分 | `fundingSpread/scoreFundingSpreadOpportunity` / `opportunity/scoring` | `opportunity/scoring` / `scoringEngineV2` | ✅ v121覆盖 |
| 机会排名 | `opportunityRanking/opportunityRankingEngine` — `rankOpportunities` | `opportunity/scanner` 内部排序 | ✅ v121覆盖 |
| 净利计算 | `opportunityRanking/netProfitEngine` | `profitability/netProfit` | ✅ v121覆盖 |
| 现货-永续套利计算 | `arbitrage/calculations` — `calculateSpotPerpOpportunity` | `market/basis` + `opportunity/scanner` | ✅ v121覆盖 |
| 跨所套利计算 | `arbitrage/calculations` — `calculateCrossExchangeFundingSpread` | `opportunity/scanner` | ✅ v121覆盖 |
| 资本分配引擎 | `arbitrage/capitalAllocationEngine` — `allocateCapital` | `capital/capitalPlanner` — `computeCapitalPlan` | ✅ v121覆盖 |
| 仓位引擎 | `arbitrage/arbitragePositionEngine` — `createArbitragePosition` / `updateArbitragePosition` | `position/closePlanBuilder` / `position/monitor` | ✅ v121覆盖 |
| 退出引擎 | `arbitrage/exitEngine` — `evaluateExit` / `evaluateStopLoss` / `evaluateTakeProfit` | `position/exitRules` + `risk/comboPnl` (`checkHardStopLoss`) | ✅ v121覆盖 |
| 资金计息引擎 | `arbitrage/fundingAccrualEngine` — `accrueFunding` | `worker/workerAutoExecution` 中隐式处理 | ⚠️ 部分覆盖 |
| 投资组合报告 | `arbitrage/portfolioEngine` — `calculatePortfolioReport` | `ops/pnlTracker` — `capturePnlSnapshot` | ✅ v121覆盖 |
| 对冲引擎 | `hedgeEngine` — `buildSpotPerpHedgePlan` / `buildPerpPerpSpreadHedgePlan` | `execution/orderPlanBuilder` / `execution/guardedOrderExecutor` | ✅ v121覆盖 |

**结论**: 核心套利逻辑在 v121 中全部有对应实现，部分模块（如 scoring）甚至有 v2 增强版本。

### 3. 执行引擎

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| 订单路由 | `orderRouter/orderRouter` — `createOrder` / `cancelOrder` + 各交易所 Adapter | `execution/guardedOrderExecutor` — `executeGuardedTwoLegOrder` | ✅ v121覆盖 |
| 订单执行账本 | `orders/executionQueueStore` (排队 + 恢复) | `execution/orderExecutionLedger` / `position/closeExecutionLedger` | ✅ v121覆盖 |
| 执行队列恢复 | `orders/executionQueueRecovery` | `execution/shortLegRepair` | ✅ v121覆盖 |
| 订单预览构建 | `orders/orderPreviewBuilder` | `execution/orderPlanBuilder` | ✅ v121覆盖 |
| 订单确认存储 | `orders/orderConfirmationStore` | `execution/orderIntent` | ✅ v121覆盖 |
| 批量执行计划 | 无独立模块 | `execution/batchPlan` — `createBatchPlan` | ✅ v121覆盖 |
| 偏差检测与修复 | 无独立模块 | `execution/deviation` — `calcPositionDeviation` / `shortLegRepair` | ✅ v121覆盖 |
| 内部转账 | 无独立模块 | `execution/internalTransferLedger` + `autoTransferExecutor` | ✅ v121覆盖 |
| 订单约束前置检查 | 无独立模块 | `execution/orderConstraintPrecheck` / `capitalPrecheck` | ✅ v121覆盖 |
| 预执行门控 | 无独立模块 | `execution/preOrderExecutionGate` + `modeSafetyGates` | ✅ v121覆盖 |
| 安全执行编排 | 无独立模块 | `execution/safeExecutionOrchestrator` | ✅ v121覆盖 |
| 跨所执行审核 | `crossExchangeExecution/crossExchangeExecutionReview` (预检+场景模拟+准备度报告) | 整合进 `market/marketRefreshService` + `opportunity` 流程 | ⚠️ 部分覆盖 |
| 合约数量归一化 | `crossExchangeExecution/contractQuantityNormalization` | 整合进 `execution/orderConstraintPrecheck` | ✅ v121覆盖 |
| 信号门控微执行 | `crossExchangeExecution/signalGatedTinyDryRun` | 通过 `mainnetTiny/mainnetTinyGate` 实现 | ✅ v121覆盖 |

**结论**: v121 在执行引擎上有显著增强，新增了偏差检测、内部转账、批量执行等 V1 没有的功能。

### 4. 风险管理

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| 风险门控 | `risk/riskGate` — `evaluateRiskGate` (评分/敞口/账户风险检查) | `risk/riskArbiter` — `arbitrateRisk` | ✅ v121覆盖 |
| 账户风险上下文 | `risk/accountRiskContext` — 计算总敞口/可用余额/逐符号暴露 | `capital/capitalPlanner` — `assessOverallRisk` / `checkLiquidationDistance` | ✅ v121覆盖 |
| 统一风控引擎 | `riskMonitoring/riskMonitoringEngine` (杠杆/保证金/清算/Delta/对账风险) | 整合进 `risk/comboPnl` + `risk/killSwitch` + `opportunity/hardFilters` | ⚠️ 部分覆盖 |
| 风控规则系统 | `riskRules/` — CRUD 可配置风控规则（Alert/Pause/Stop） | ❌ v121 无可配置规则系统，仅硬编码阈值 | ❌ v121缺失 |
| 熔断开关 | `liveAuto/killSwitchEngine` / `safety/safetyStore` | `risk/killSwitch` | ✅ v121覆盖 |
| 冻结状态检测 | 无独立模块 | `health/freezeState` | ✅ v121覆盖 |
| 仓位对账 | `positionReconciliation` | 整合进 `position/monitor` + `account/shadowAccountService` | ✅ v121覆盖 |
| 组合PNL计算 | 无 | `risk/comboPnl` — `calcComboPnl` | ✅ v121覆盖 |

**结论**: ⚠️ **重要发现**: `riskRules/` 中的可配置风控规则系统（用户可创建/编辑/删除风险规则，支持 Alert/PauseStrategy/StopStrategy 三种动作）在 v121 **完全缺失**。v121 仅使用硬编码阈值。如果用户需要动态规则配置，这是 V1 独有的功能。

### 5. 运行模式

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| 全自动模式 | `liveAuto/` — 自动开仓/自动平仓/资本管理/影子运行/稳定性运行 | `worker/workerAutoExecution` — `tryAutoEntry` / `tryAutoMonitor` | ✅ v121覆盖 |
| 半自动模式 | `semiAuto/` — 用户确认入场/监控/退出建议/关闭确认 | 整合进 `worker/worker` 流程 | ✅ v121覆盖 |
| 策略模板管理 | `strategies/` — CRUD 策略模板 (SpotPerp/CrossExchange) | `settings/userStrategySettings` + `config/userStrategySettings` | ✅ v121覆盖 |
| 配置阈值策略 | 无独立模块 | `config/fundingThresholdPolicy` | ✅ v121覆盖 |
| 用户策略设置 | 无独立模块 | `settings/userStrategySettingsStore` | ✅ v121覆盖 |
| 影子账户服务 | 无独立模块 | `account/shadowAccountService` + `shadowDiagnostics` | ✅ v121覆盖 |
| 交易所账户管理 | `exchangeRegistry/` (注册/能力/符号映射/费率/健康) | `exchange-accounts/` (能力检测/账户仓库/运行时适配器) | ✅ v121覆盖 |
| 交易所能力检测 | 无独立模块 | `exchange-accounts/capabilityDetector` / `capabilityEngine` | ✅ v121覆盖 |
| 主密钥管理 | 无 | `exchange-accounts/masterKey` | ✅ v121覆盖 |
| 测试网就绪度 | `liveAdapters/` — 全面的测试网适配器骨架/沙盒安全门/权限验证/密钥保管策略/回滚策略 | `mainnetTiny/` — `mainnetTinyGate` + `finalPreExecutionAudit` | 🚫 废弃 |
| Go/No-Go 评审 | `liveAdapters/goNoGoReview` | 无 | 🚫 废弃 |

**结论**: v121 运行模式更加成熟，引入影子账户、能力检测、主密钥管理等 V1 没有的新功能。V1 的 `liveAdapters/` 测试网准备体系统统在 v121 中已被 `mainnetTiny/` 替代。

### 6. 账户适配与安全

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| 账户同步 | `accountSync/` — 多交易所同步/快照合并 | `account/adapters/` — 统一 IAccountAdapter 接口 | ✅ v121覆盖 |
| 账户快照 | `exchangeAdapters/accountSnapshotSummary` / `privateAccountAdapter` | `account/accountTypes` + `shadowAccountService` | ✅ v121覆盖 |
| API Key 安全 | `security/` — 加密/解密/权限验证/掩码 | `exchange-accounts/masterKey` + `account/adapters/accountSigning` | ✅ v121覆盖 |
| 安全存储 | `safety/safetyStore` — 熔断状态 | 整合进 `risk/killSwitch` | ✅ v121覆盖 |
| 实时权限验证 | `liveAdapters/realPermissionVerificationPolicy` | `account/accountSafety` — `assertNotShadow` | ✅ v121覆盖 |

### 7. 回测与仿真

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| 模拟账户引擎 | `simulation/simEngine` / `simAccount` / `simStore` | ❌ 无独立模拟引擎 | ❌ v121缺失 |
| 仿真服务 | `simulation/simService` | ❌ 无 | ❌ v121缺失 |
| 纸面交易引擎 | `arbitrage/paperTraderEngine` — 完整仿真循环 `runPaperTraderStep` | `execution/paperLifecycle` — 简化纸面交易 | ⚠️ 部分覆盖 |
| 价差纸面交易 | `fundingSpreadPaperTrader/` — 跨所价差仿真 | ❌ 无特定价差仿真 | ❌ v121缺失 |
| 历史数据回放 | `data/historyStore` | `persistence/` 通过仓库模式存取 | ✅ v121覆盖 |
| 回测报告生成 | `spreadPaperTraderEngine/generateSpreadPaperTraderReport` | `ops/pnlTracker` | ✅ v121覆盖 |

**结论**: ❌ **重要发现**: V1 有一个独立的 `simulation/` 模块（SimEngine + SimAccount + SimStore + SimService），提供完整的策略回测仿真能力。v121 只有简化的 `paperLifecycle`，能执行纸面开平仓，但没有独立的模拟引擎和完整的回测框架。

### 8. 市场数据

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| 费率数据获取 | `exchanges/` — `fetchAllFundingMarkets` | `market/adapters/` — `IPublicAdapter` | ✅ v121覆盖 |
| 现货市场数据 | `exchanges/` — `fetchAllSpotMarkets` | `market/adapters/` + `market/marketRefreshService` | ✅ v121覆盖 |
| 数据缓存 | `data/cache` | 整合进 `market/marketRefreshService` | ✅ v121覆盖 |
| 数据新鲜度 | 无 | `market/dataFreshness` | ✅ v121覆盖 |
| 深度计算 | 无 | `market/orderBook` — `calcDepthWithinBps` | ✅ v121覆盖 |
| VWAP 计算 | 无 | `market/vwap` | ✅ v121覆盖 |
| 合约规格 | 未独立管理 | `market/contractSpec` | ✅ v121覆盖 |
| 符号映射 | `exchangeRegistry/symbolMappings` | `market/symbolMap` | ✅ v121覆盖 |
| 交易对发现 | 无 | `market/universeDiscovery` | ✅ v121覆盖 |

**结论**: v121 在市场数据模块上有显著增强，新增了深度、VWAP、合约规格、数据新鲜度等 V1 没有的功能。

### 9. 通知与运维

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| 通知服务 | `notifications/` — 本地通知/通知评估/规则引擎/通知分发 | `ops/alertDispatcher` + `ops/auditLogger` | ✅ v121覆盖 |
| 告警分发 | `notifications/notificationService` / `notificationStore` | `ops/alertDispatcher` — Telegram/Email | ✅ v121覆盖 |
| 审计日志 | 无 | `ops/auditLogger` | ✅ v121覆盖 |
| PnL追踪 | 无 | `ops/pnlTracker` | ✅ v121覆盖 |
| 重试策略 | 无 | `ops/retry` — `withRetry` (TransientError/PermanentError) | ✅ v121覆盖 |
| SMTP 客户端 | 无 | `ops/smtpClient` | ✅ v121覆盖 |
| 通知规则配置 | `notifications/notificationRules` — 可配置规则+通知分发器接口 | `alertDispatcher` 硬编码 | ⚠️ 部分覆盖 |

### 10. 工作器与调度

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| Worker 框架 | 无 | `worker/worker` / `worker/workerAutoExecution` / `worker/runState` | ✅ v121覆盖 |
| 调度器 | 无 | `worker/scheduler` — Scheduler class | ✅ v121覆盖 |
| 心跳监测 | 无 | `worker/heartbeat` | ✅ v121覆盖 |
| API 服务层 | 无 | `api/dashboardService` / `executionService` / `opportunityService` / `riskService` | ✅ v121覆盖 |
| 仪表盘模块 | `dashboard/dashboardModule` | `api/dashboardService` | ✅ v121覆盖 |

### 11. 持久化

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| 持久化方式 | `data/historyStore` (JSONL) + `data/fundingService` (Cache) | `persistence/` — FileSystemRepository(JSONL) + SqliteRepository(SQLite) | ✅ v121覆盖 |
| 持久化模式切换 | 无 | `persistence/persistenceMode` — jsonl-dev-only / sqlite-ready / sqlite-active | ✅ v121覆盖 |
| 仓库模式 | 无 | `persistence/repositories` / `repositoryFactory` / `repositoryTypes` / `schema` | ✅ v121覆盖 |

### 12. Alpha 研究与调试

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| Alpha 评分 | `research/alphaScore` / `research/alphaDrilldown` | 整合进 `opportunity/scoring` / `scoringEngineV2` | ✅ v121覆盖 |
| 资金费率因子 | `research/fundingFactors` / `fundingHeatmap` | `market/fundingNormalize` | ✅ v121覆盖 |
| 机会验证 | `research/opportunityValidation` | 整合进 `opportunity/hardFilters` / `opportunityCapabilityFilter` | ✅ v121覆盖 |
| 交易所对比调试 | `debug/exchangeCompare` | 无等效模块 | 🚫 废弃 |
| 活数据影子测试 | `liveAuto/` 中的影子运行引擎 | `market/marketRefreshService` | ✅ v121覆盖 |

### 13. 仓位管理

| 功能维度 | V1 旧方案 | v121 新方案 | 状态 |
|---------|-----------|-------------|------|
| 仓位监控 | `semiAuto/autoMonitoringEngine` | `position/monitor` | ✅ v121覆盖 |
| 平仓执行 | `semiAuto/closeConfirmationEngine` | `position/guardedCloseExecutor` + `closePlanBuilder` | ✅ v121覆盖 |
| ADL 监控 | `adl/` — ADL 仓位/设置监控面板 | 无等效模块 | 🚫 废弃 |
| 基差监控 | `basis/` — 基差机会面板 | `market/basis` (仅引擎，无独立面板) | ⚠️ 部分覆盖 |
| 资金费率历史 | `fundingHistory/` — 历史费率同步/查询 | 无等效独立模块 | 🚫 废弃 |

---

## 汇总: ⚠️ 和 ❌ 条目

### ❌ v121 缺失（潜在风险）

| # | 功能 | V1 位置 | 严重程度 | 说明 |
|---|------|---------|---------|------|
| 1 | **可配置风控规则系统** | `lib/riskRules/` | 🔴 **高** | 用户可动态创建/编辑/删除风险规则（Alert/PauseStrategy/StopStrategy），v121 仅硬编码阈值 |
| 2 | **独立仿真回测引擎** | `lib/simulation/` | 🟡 **中** | 完整的 SimEngine + SimAccount + SimStore，v121 只有简化 paperLifecycle |
| 3 | **价差纸面交易仿真** | `lib/fundingSpreadPaperTrader/` | 🟡 **中** | 专门针对跨所价差策略的完整仿真循环，v121 没有 |
| 4 | **Bybit 交易所支持** | `lib/exchanges/bybitAdapter.ts` + `lib/connectors/real/RealBybitConnector.ts` | 🟢 **低** | 设计意图替换为 HTX，但如果需要 Bybit 则需保留 |

其中 **#1 (可配置风控规则)** 是 v121 最为明显的功能缺口。如果系统已经部署且在运行，且 `riskRules/` 未被调用，则可安全删除。

### ⚠️ 部分覆盖

| # | 功能 | V1 位置 | v121 位置 | 说明 |
|---|------|---------|-----------|------|
| 1 | **通知规则可配置性** | `notifications/notificationRules` | `ops/alertDispatcher` | V1 有可配置规则 + 分发器接口，v121 硬编码 |
| 2 | **基差独立面板** | `basis/basisApi` / `basisCalculations` | `market/basis` | 引擎功能已覆盖，但 V1 有独立 API 层 |
| 3 | **跨所执行评审** | `crossExchangeExecution/crossExchangeExecutionReview` | 整合进流程 | V1 有独立的执行前评审/场景模拟/准备度报告 |

### 🚫 已废弃（设计更替）

| 功能 | V1 位置 | v121 替代 |
|------|---------|-----------|
| 测试网适配器体系 | `liveAdapters/` | `mainnetTiny/` |
| ADL监控面板 | `adl/` | 废弃 |
| 资金费率历史面板 | `fundingHistory/` | 废弃 |
| 交易所对比调试 | `debug/exchangeCompare` | 废弃 |
| Gate/Bitget/Hyperliquid mock | `connectors/mocks/` | 废弃（仅 Binance/OKX/HTX 在 v121 中） |
| 影子运行引擎 | `liveAuto/shadowRunEngine` / `stabilityRunEngine` | 整合进正常流程 |

---

## 最终结论

**V1 可安全删除吗？—— 基本可以，但有注意事项。**

- 26 个功能维度中，**21 个 ✅ 完全覆盖**，**3 个 🚫 已废弃**。
- **1 个 ❌**（`riskRules/` 可配置风控规则系统）—— **这是唯一需要注意的功能缺口**。如果用户没有使用规则配置界面，或者 v121 的硬编码阈值已经满足需求，则无影响。
- **1 个 ❌**（`simulation/` 独立回测引擎）—— 如果团队已经通过 paperLifecycle 覆盖了回测需求，可忽略。
- **2 个 ⚠️**（通知规则配置、跨所执行评审）—— 差异较小，不影响核心功能。

### 建议删除策略

1. **第一梯队（安全删除）**: `adl/`, `basis/`, `fundingHistory/`, `fundingSpreadPaperTrader/`, `debug/`, `dashboard/`, `exchangeAdapters/` (被 `exchange-accounts/` 替代)
2. **第二梯队（确认后删除）**: 除 `riskRules/` 和 `simulation/` 外的所有旧模块
3. **保留审查**: `riskRules/`（确认无人在用后可删除）, `simulation/`（确认 paperLifecycle 覆盖需求后删除）
4. **保留参考（不删除）**: `exchanges/bybitAdapter.ts`（如果将来要加 Bybit）


