# as any 与 process.env 清洗方案设计

- **项目**：`E:\ai\spot-perp-funding-bot`
- **日期**：2026-07-01
- **范围**：`lib/strategy-v121` 生产代码（不含测试文件）
- **目标**：降低类型腐化风险，统一环境变量入口，提升真实交易路径的可维护性。
- **原则**：分阶段、低风险、优先清洗交易路径与可测试性差的代码；不引入运行时行为改变。

---

## 1. 现状统计

### 1.1 生产代码中 `as any` 分布

| 文件 | 次数 | 主要场景 |
|------|------|----------|
| `worker/workerAutoExecution.ts` | 12 | 市场快照字段读取、持仓/余额/订单 `any[]`、下单参数构造 |
| `exchange-accounts/runtimeAdapterFactory.ts` | 10 | 私有 `_apiKey/_apiSecret/_passphrase` 访问、错误码 `code` 注入、订单状态断言 |
| `mainnetTiny/finalPreExecutionAudit.ts` | 10 | 从 repository 读取 `latest`/`queryAll` 的混合 snake/camel 字段 |
| `mainnetTiny/mainnetTinyPreflight.ts` | 3 | 同上，读取 `latest_scan` / `worker_heartbeat` 时间字段 |
| `position/guardedCloseExecutor.ts` | 3 | 余额/仓位/订单 `any[]` 查找 |
| `opportunity/opportunityWatcher.ts` | 3 | `repo.save` / `repo.queryAll` 的 `as any` 与 `as any[]` |
| `execution/guardedOrderExecutor.ts` | 4 | `updateOrderExecution(partial as any)`、注释自相矛盾 |
| `persistence/closeExecutionLedger.ts` | 5 | `repo.save` 与 `repo.queryAll` 的 any 转换 |
| `persistence/closePlanLedger.ts` | 4 | 同上 |
| `settings/userStrategySettingsStore.ts` | 3 | repository 行转换 |
| `persistence/basePersistence.ts` | 2 | `record as any` 保存 |
| `execution/orderExecutionLedger.ts` | 3 | 同上 |
| `execution/orderPlanLedger.ts` | 3 | 同上 |
| `opportunity/opportunityStore.ts` | 2 | `save` 与 `queryAll` 行转换 |
| `execution/orderIntent.ts` | 2 | `save` 行转换 |
| `worker/heartbeat.ts` | 1 | `save` 行转换 |
| `worker/workerExecutionHelpers.ts` | 2 | 余额/仓位 any[] |
| `exchange-accounts/exchangeAccountService.ts` | 1 | dummy order plan 中的 `as any` |
| `execution/autoTransferExecutor.ts` | 1 | `adapterResult as any` |
| `persistence/repositoryFactory.ts` | 1 | `setPersistenceMode(m as any)` |
| `persistence/sqliteRepository.ts` | 1 | `row as any` 读取 count |
| `config/userStrategySettings.ts` | 1 | `latest as any` |
| `ops/smtpClient.ts` | 2 | socket 类型断言 |
| `capital/capitalPlanner.ts` | 1 | `"binance" as any` |
| `testing/opportunityFixtures.ts` | 1 | fixture 构造 |
| `market/marketRefreshService.ts` | 1 | 保存 opportunity_records 行 |
| **合计** | **~78** | — |

> 注：上一轮全局检查报告统计生产代码 110 处，本次统计口径为 `lib/strategy-v121` 非测试文件，差异来自 `app/`、`scripts/`、`components/` 以及测试文件。

### 1.2 生产代码中 `process.env` 分布

| 文件 | 次数 | 主要场景 |
|------|------|----------|
| `exchange-accounts/runtimeAdapterFactory.ts` | 12 | 真实下单/划转/平仓开关（`V121_ENABLE_REAL_*`） |
| `ops/alertDispatcher.ts` | 8 | 告警渠道配置（Telegram / Email） |
| `account/adapters/binanceAccountAdapter.ts` | 5 | 真实下单/划转/平仓开关 |
| `account/adapters/okxAccountAdapter.ts` | 5 | 真实下单/划转/平仓开关 |
| `execution/capitalPrecheck.ts` | 6 | 风控参数（保留金、缓冲率、自动划转） |
| `mainnetTiny/mainnetTinyGate.ts` | 4 | 模式门禁（`V121_MODE` 等） |
| `account/shadowAccountService.ts` | 4 | SHADOW 模式密钥 / mock 开关 |
| `mainnetTiny/finalPreExecutionAudit.ts` | 3 | 真实下单开关、内部转账开关 |
| `mainnetTiny/mainnetTinyPreflight.ts` | 1 | 真实下单开关 |
| `execution/guardedOrderExecutor.ts` | 2 | kill switch、真实下单开关 |
| `position/guardedCloseExecutor.ts` | 2 | kill switch、真实平仓开关 |
| `position/closePrecheckGate.ts` | 2 | kill switch、真实平仓开关 |
| `execution/orderIntent.ts` | 2 | 真实下单开关、dry run |
| `execution/preOrderExecutionGate.ts` | 1 | kill switch |
| `exchange-accounts/exchangeAccountService.ts` | 1 | dummy plan 注释（不涉及） |
| `exchange-accounts/masterKey.ts` | 1 | `V121_MASTER_KEY` |
| `persistence/sqliteRepository.ts` | 1 | `V121_SQLITE_PATH` |
| `persistence/persistenceMode.ts` | 1 | `V121_PERSISTENCE_MODE` |
| `persistence/repositoryFactory.ts` | 1 | `V121_PERSISTENCE_MODE` |
| `config/strategyConfig.ts` | 1 | `V121_MODE` |
| `config/fundingThresholdPolicy.ts` | 2 | 测试阈值开关 |
| `worker/workerAutoExecution.ts` | 2 | `canPlaceRealOrders` 时传入 `process.env` 快照 |
| `worker/worker.ts` | 1 | `V121_MAX_DYNAMIC_SYMBOLS_PER_EXCHANGE` |
| `runtime/devToolsGate.ts` | 1 | `V121_ENABLE_DEV_TOOLS` |
| `account/adapters/accountAdapterFactory.ts` | 1 | `V121_SHADOW_USE_MOCK` |
| `account/adapters/accountSigning.ts` | 2 | 密钥读取 |
| **合计** | **~82** | — |

### 1.3 与上一轮审查对比

- `as any`：上一轮统计生产代码 110 处，本轮 `lib/strategy-v121` 非测试文件约 78 处。`app/`、`scripts/`、`components/` 仍有约 30 处。
- `process.env`：上一轮统计生产代码 87 处，本轮 `lib/strategy-v121` 非测试文件约 82 处。
- 重灾区未变：`runtimeAdapterFactory`、`workerAutoExecution`、`finalPreExecutionAudit` 仍为双高区域。

---

## 2. 问题分类

### 2.1 `as any` 分类

| 类别 | 典型模式 | 文件 | 风险 |
|------|----------|------|------|
| **A. Repository 行类型缺失** | `repo.queryAll(T) as any[]`、`record as any` | `closePlanLedger.ts`、`closeExecutionLedger.ts`、`orderExecutionLedger.ts`、`orderPlanLedger.ts`、`userStrategySettingsStore.ts`、`opportunityStore.ts`、`opportunityWatcher.ts`、`orderIntent.ts`、`heartbeat.ts` | 数据库 schema 与代码不同步时编译器无法检测，字段名错误（如 snake/camel 混用）导致运行时空值。 |
| **B. 运行时私有字段访问** | `(this as any)._apiKey` | `runtimeAdapterFactory.ts` | 绕过类型检查，属性不存在时运行时错误；不安全枚举。 |
| **C. 错误对象动态字段** | `(err as any).code = -2015` | `runtimeAdapterFactory.ts`、`binanceAccountAdapter.ts` | 错误类型不统一，调用方难以稳定消费。 |
| **D. 市场快照字段访问** | `(s as any)?.bid1` | `workerAutoExecution.ts`、`workerExecutionHelpers.ts` | 已有 `MarketSnapshot` 类型但未被使用，重复代码。 |
| **D. 状态/枚举断言** | `status as any`、`exchange as any` | `runtimeAdapterFactory.ts`、`finalPreExecutionAudit.ts` | 非法枚举值可能穿透到真实交易逻辑。 |
| **E. 测试 fixture / 临时对象** | `} as any);` | `opportunityFixtures.ts` | 测试辅助代码，影响较小。 |
| **F. 外部 API 类型缺失** | `socket as any` | `smtpClient.ts` | 外部类型定义不完善。 |
| **G. 简单字符串误用** | `"binance" as any` | `capitalPlanner.ts` | 无意义断言。 |

### 2.2 `process.env` 分类

| 类别 | 环境变量 | 文件 | 风险 |
|------|----------|------|------|
| **F1. 真实交易开关** | `V121_ENABLE_REAL_ORDER_EXECUTION`、`V121_ENABLE_REAL_CLOSE_EXECUTION`、`V121_ENABLE_REAL_INTERNAL_TRANSFER` | `runtimeAdapterFactory.ts`、`binanceAccountAdapter.ts`、`okxAccountAdapter.ts`、`guardedOrderExecutor.ts`、`guardedCloseExecutor.ts`、`closePrecheckGate.ts` | 开关分散，测试需逐一 mock；命名不一致（如 `V121_REAL_ORDER_EXECUTION_ENABLED` 与 `V121_ENABLE_REAL_ORDER_EXECUTION`）。 |
| **F2. 风控参数** | `V121_GLOBAL_RESERVE_RATE`、`V121_MIN_GLOBAL_RESERVE_USDT`、`V121_SPOT_BUFFER_RATE`、`V121_PERP_BUFFER_RATE`、`V121_ALLOW_AUTO_TRANSFER`、`V121_AUTO_TRANSFER_MAX_USDT` | `capitalPrecheck.ts` | 与 `UserStrategySettings` 重复或冲突，参数来源不一致。 |
| **F3. 告警配置** | `V121_ALERT_TELEGRAM_*`、`V121_ALERT_EMAIL_*` | `alertDispatcher.ts` | 配置分散，难以 mock 和验证。 |
| **F4. 模式门禁** | `V121_MODE`、`V121_MAINNET_TINY_ENABLED`、`V121_CONFIRM_MAINNET_TINY_RISK`、`V121_LIVE_ENABLED` | `mainnetTinyGate.ts`、`strategyConfig.ts` | 与 `StrategyConfig` 既有交叉又有重复。 |
| **F5. 密钥与签名** | `BINANCE_API_KEY`、`OKX_API_KEY` 等 | `accountSigning.ts`、`shadowAccountService.ts`、`accountAdapterFactory.ts` | 密钥读取分散，SHADOW 与 runtime adapter 混淆。 |
| **F6. 持久化与路径** | `V121_SQLITE_PATH`、`V121_PERSISTENCE_MODE` | `sqliteRepository.ts`、`persistenceMode.ts`、`repositoryFactory.ts` | 已相对集中，可收口到一处。 |
| **F7. 其他开关** | `V121_KILL_SWITCH`、`V121_MAX_DYNAMIC_SYMBOLS_PER_EXCHANGE`、`V121_ENABLE_DEV_TOOLS`、`V121_TEST_FUNDING_THRESHOLD_*` | 多个文件 | 语义分散，kill switch 被当作 env 读而不是持久化状态。 |

---

## 3. 总体设计

### 3.1 目标

- 将 `process.env` 读取收口到 `lib/strategy-v121/config/` 下的统一模块。
- 将 `as any` 按类别替换为具体类型，优先处理真实交易路径和双高文件。
- 不引入运行时行为变化；所有改动应保持现有功能等价。

### 3.2 统一配置入口设计

新增模块：`lib/strategy-v121/config/runtimeConfig.ts`

```typescript
/**
 * RuntimeConfig — 策略运行时所有环境变量的统一读取入口。
 *
 * 设计原则：
 * 1. 所有 process.env 读取在模块初始化时完成一次，后续使用快照。
 * 2. 提供强类型 getter，返回类型明确。
 * 3. 支持测试通过 resetRuntimeConfig() 重新加载。
 * 4. 不引入外部依赖（如 zod），避免增加包体积；使用 TypeScript 类型 + 运行时校验函数。
 */

export interface RuntimeConfig {
  mode: StrategyMode;
  persistenceMode: string;
  sqlitePath: string;

  // 真实交易开关
  featureFlags: {
    realOrderExecutionEnabled: boolean;
    realCloseExecutionEnabled: boolean;
    realInternalTransferEnabled: boolean;
  };

  // 模式门禁
  mainnetTiny: {
    enabled: boolean;
    riskConfirmed: boolean;
  };
  controlledLive: {
    enabled: boolean;
    riskConfirmed: boolean;
  };

  // 风控参数（优先使用 UserStrategySettings，此处作为兜底/覆盖）
  capital: {
    globalReserveRate: number;
    minGlobalReserveUsdt: number;
    spotBufferRate: number;
    perpBufferRate: number;
    allowAutoTransfer: boolean;
    autoTransferMaxUsdt: number;
  };

  // 告警配置
  alert: {
    telegram: { botToken: string; chatId: string } | null;
    email: {
      smtpHost: string;
      smtpPort: number;
      user: string;
      pass: string;
      to: string;
      from: string;
    } | null;
  };

  // 其他
  maxDynamicSymbolsPerExchange: number;
  devToolsEnabled: boolean;
  killSwitchFallback: KillSwitchState; // 仅当无持久化状态时的兜底
  testFundingThreshold: {
    enabled: boolean;
    value8h: number | null;
  };
  masterKey: string | undefined;
}

let _config: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (!_config) _config = loadRuntimeConfig();
  return _config;
}

export function resetRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  _config = loadRuntimeConfig(env);
  return _config;
}

export function isRealOrderExecutionEnabled(): boolean {
  return getRuntimeConfig().featureFlags.realOrderExecutionEnabled;
}

// ... 其他便捷 getter
```

### 3.3 类型化 persistence 行设计

新增类型文件：`lib/strategy-v121/persistence/repositoryRowTypes.ts`

为常用表定义行类型，替换 `as any` 和 `as any[]`：

```typescript
export interface LatestScanRow {
  id: string;
  total_paths?: number;
  passed_count?: number;
  rejected_count?: number;
  data_source?: string;
  scanned_at_utc?: number;
  scannedAtUtc?: number;
  opportunities_json?: string;
  opportunities?: unknown[];
  reject_summary_json?: string;
  rejectSummary?: Record<string, number>;
  errors_json?: string;
  errors?: unknown[];
  duration_ms?: number;
  symbols_scanned?: number;
  exchanges_scanned?: number;
}

export interface WorkerHeartbeatRow {
  id: string;
  worker_id?: string;
  workerId?: string;
  state?: string;
  mode?: string;
  last_cycle_at_utc?: number;
  lastCycleAtUtc?: number;
  cycle_count?: number;
  cycleCount?: number;
  last_error?: string;
  lastError?: string;
}

export interface UserStrategySettingsRow {
  id: string;
  json?: string;
  settings_json?: string;
  settingsJson?: string;
  value?: string;
  data?: string;
  created_at_utc?: number;
  createdAtUtc?: number;
  updated_at_utc?: number;
  updatedAtUtc?: number;
}

export interface OpportunityAlertRow {
  id: string;
  status?: "new" | "acknowledged" | "expired" | "converted_to_intent";
  detected_at_utc?: number;
  detectedAtUtc?: number;
  // ... 其他字段
}

// close_plan_ledger / close_execution_ledger / order_execution_ledger / order_plan_ledger 等
```

并配套读取辅助函数：

```typescript
export function readTimestamp(row: { [k: string]: unknown }, keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function readString(row: { [k: string]: unknown }, keys: string[], fallback = ""): string {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined) continue;
    return String(v);
  }
  return fallback;
}
```

### 3.4 错误对象标准化

新增：`lib/strategy-v121/account/adapters/exchangeError.ts`

```typescript
export interface ExchangeError extends Error {
  code?: number | string;
  raw?: unknown;
}

export function createExchangeError(message: string, code?: number | string, raw?: unknown): ExchangeError {
  const err = new Error(message) as ExchangeError;
  err.code = code;
  err.raw = raw;
  return err;
}

export function isExchangeError(err: unknown): err is ExchangeError {
  return err instanceof Error && "code" in err;
}

export function getErrorCode(err: unknown): number | string | undefined {
  if (isExchangeError(err)) return err.code;
  return undefined;
}
```

替换 `runtimeAdapterFactory.ts` 和 `binanceAccountAdapter.ts` 中 `(err as any).code = ...` 的写法。

### 3.5 运行时 Adapter 私有字段标准化

在 `runtimeAdapterFactory.ts` 中，将 `Object.defineProperty(this, "_apiKey", ...)` 改为声明私有字段：

```typescript
class BinanceRuntimeAdapter implements IAccountAdapter {
  readonly exchangeId: ExchangeId = "binance";
  readonly #apiKey: string;
  readonly #apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.#apiKey = apiKey;
    this.#apiSecret = apiSecret;
  }
}
```

这可以消除 6 处 `(this as any)._apiKey` / `_apiSecret` / `_passphrase` 的 `as any`。

### 3.6 市场快照字段标准化

`workerAutoExecution.ts` 和 `workerExecutionHelpers.ts` 中应使用 `MarketSnapshot` 类型：

```typescript
// 当前
spotPrice = (s as any)?.bid1 ?? 0;

// 修复后
spotPrice = s?.bid1 ?? 0;
```

要求 `getLatestSpotSnapshot` / `getLatestPerpSnapshot` 等内部函数返回 `MarketSnapshot | undefined`，而不是 `any`。

### 3.7 状态/枚举断言标准化

在 `finalPreExecutionAudit.ts` 中：

```typescript
// 当前
exchange: exchange as any,
purpose: (latestIntent.purpose ?? ...) as any,

// 修复后
import { isExchangeId } from "../domain/types";
import { isOrderIntentPurpose } from "../execution/orderIntent";

exchange: isExchangeId(exchange) ? exchange : "binance",
purpose: isOrderIntentPurpose(purposeValue) ? purposeValue : "real_arbitrage",
```

新增类型守卫：`isExchangeId`、`isOrderIntentPurpose`、`isOrderExecutionStatus`。

---

## 4. 文件变更清单

| 文件 | 变更内容 | 优先级 |
|------|----------|--------|
| `lib/strategy-v121/config/runtimeConfig.ts` | 新建：统一读取所有 `process.env` | P0 |
| `lib/strategy-v121/config/featureFlags.ts` | 新建：真实交易开关便捷 getter | P0 |
| `lib/strategy-v121/config/alertConfig.ts` | 新建：告警配置封装 | P0 |
| `lib/strategy-v121/persistence/repositoryRowTypes.ts` | 新建：常用表行类型 + 读取辅助函数 | P1 |
| `lib/strategy-v121/account/adapters/exchangeError.ts` | 新建：标准 ExchangeError 类型 | P1 |
| `lib/strategy-v121/domain/types.ts` | 增加 `isExchangeId` 类型守卫 | P1 |
| `lib/strategy-v121/execution/orderIntent.ts` | 增加 `isOrderIntentPurpose` 类型守卫 | P1 |
| `lib/strategy-v121/execution/orderExecutionTypes.ts` | 增加 `isOrderExecutionStatus` 类型守卫 | P1 |
| `lib/strategy-v121/exchange-accounts/runtimeAdapterFactory.ts` | 1. 私有字段改用 `#`；2. 使用 `ExchangeError`；3. 使用 `runtimeConfig` 读取开关；4. 替换 `status as any` | P0 |
| `lib/strategy-v121/account/adapters/binanceAccountAdapter.ts` | 使用 `ExchangeError` 与 `runtimeConfig` | P1 |
| `lib/strategy-v121/account/adapters/okxAccountAdapter.ts` | 使用 `runtimeConfig` 读取开关 | P1 |
| `lib/strategy-v121/execution/guardedOrderExecutor.ts` | 使用 `runtimeConfig`；修复 `partial as any`；更新 `updateOrderExecution` 类型 | P1 |
| `lib/strategy-v121/position/guardedCloseExecutor.ts` | 使用 `runtimeConfig`；使用 `AccountBalanceSnapshot`/`AccountPositionSnapshot`/`OpenOrderSnapshot` 类型 | P1 |
| `lib/strategy-v121/position/closePrecheckGate.ts` | 使用 `runtimeConfig` | P1 |
| `lib/strategy-v121/execution/capitalPrecheck.ts` | 使用 `runtimeConfig` | P1 |
| `lib/strategy-v121/ops/alertDispatcher.ts` | 使用 `alertConfig` | P1 |
| `lib/strategy-v121/mainnetTiny/mainnetTinyGate.ts` | 使用 `runtimeConfig` | P1 |
| `lib/strategy-v121/mainnetTiny/mainnetTinyPreflight.ts` | 使用 `repositoryRowTypes` 读取辅助函数 | P1 |
| `lib/strategy-v121/mainnetTiny/finalPreExecutionAudit.ts` | 使用 `repositoryRowTypes` 与类型守卫 | P1 |
| `lib/strategy-v121/worker/workerAutoExecution.ts` | 使用 `MarketSnapshot` 类型；替换 `as any` | P1 |
| `lib/strategy-v121/worker/workerExecutionHelpers.ts` | 使用 `AccountBalanceSnapshot`/`AccountPositionSnapshot` 类型 | P1 |
| `lib/strategy-v121/worker/worker.ts` | 使用 `runtimeConfig` | P2 |
| `lib/strategy-v121/config/strategyConfig.ts` | `DEFAULT_CONFIG.mode` 从 `runtimeConfig` 读取 | P1 |
| `lib/strategy-v121/config/fundingThresholdPolicy.ts` | 使用 `runtimeConfig` | P2 |
| `lib/strategy-v121/account/shadowAccountService.ts` | 使用 `runtimeConfig` | P2 |
| `lib/strategy-v121/account/adapters/accountAdapterFactory.ts` | 使用 `runtimeConfig` | P2 |
| `lib/strategy-v121/account/adapters/accountSigning.ts` | 使用 `runtimeConfig` | P2 |
| `lib/strategy-v121/exchange-accounts/masterKey.ts` | 使用 `runtimeConfig` | P2 |
| `lib/strategy-v121/persistence/sqliteRepository.ts` | 使用 `runtimeConfig` | P2 |
| `lib/strategy-v121/persistence/persistenceMode.ts` | 使用 `runtimeConfig` | P2 |
| `lib/strategy-v121/persistence/repositoryFactory.ts` | 使用 `runtimeConfig` | P2 |
| `lib/strategy-v121/persistence/closePlanLedger.ts` | 使用 `repositoryRowTypes` | P2 |
| `lib/strategy-v121/persistence/closeExecutionLedger.ts` | 使用 `repositoryRowTypes` | P2 |
| `lib/strategy-v121/persistence/orderExecutionLedger.ts` | 使用 `repositoryRowTypes` | P2 |
| `lib/strategy-v121/persistence/orderPlanLedger.ts` | 使用 `repositoryRowTypes` | P2 |
| `lib/strategy-v121/persistence/basePersistence.ts` | 使用 `repositoryRowTypes` 约束 `repo.save` | P2 |
| `lib/strategy-v121/settings/userStrategySettingsStore.ts` | 使用 `repositoryRowTypes` | P2 |
| `lib/strategy-v121/opportunity/opportunityStore.ts` | 使用 `repositoryRowTypes` | P2 |
| `lib/strategy-v121/opportunity/opportunityWatcher.ts` | 使用 `repositoryRowTypes` | P2 |
| `lib/strategy-v121/execution/orderIntent.ts` | 使用 `repositoryRowTypes` | P2 |
| `lib/strategy-v121/execution/preOrderExecutionGate.ts` | 使用 `repositoryRowTypes` | P2 |
| `lib/strategy-v121/worker/heartbeat.ts` | 使用 `repositoryRowTypes` | P2 |
| `lib/strategy-v121/capital/capitalPlanner.ts` | 移除无意义 `as any` | P3 |
| `lib/strategy-v121/ops/smtpClient.ts` | 补充 socket 类型或保留 with 注释 | P3 |
| `lib/strategy-v121/testing/opportunityFixtures.ts` | 使用 fixture 类型 | P3 |
| `lib/strategy-v121/market/marketRefreshService.ts` | 使用 `repositoryRowTypes` | P3 |
| `lib/strategy-v121/runtime/devToolsGate.ts` | 使用 `runtimeConfig` | P3 |
| `lib/strategy-v121/execution/autoTransferExecutor.ts` | 使用 `runtimeConfig` 和具体类型 | P2 |

---

## 5. 实现顺序

### 阶段 1：建立统一配置入口（P0，必须先完成）

1. 新建 `lib/strategy-v121/config/runtimeConfig.ts`。
2. 新建 `lib/strategy-v121/config/featureFlags.ts`（或合并到 runtimeConfig）。
3. 新建 `lib/strategy-v121/config/alertConfig.ts`（或合并到 runtimeConfig）。
4. 为 `runtimeConfig` 编写单元测试：覆盖所有开关、默认值、reset 能力。

**依赖**：无。

### 阶段 2：替换真实交易开关的 `process.env`（P0-P1）

1. `runtimeAdapterFactory.ts` 使用 `runtimeConfig.featureFlags`。
2. `binanceAccountAdapter.ts` 使用 `runtimeConfig.featureFlags`。
3. `okxAccountAdapter.ts` 使用 `runtimeConfig.featureFlags`。
4. `guardedOrderExecutor.ts` 使用 `runtimeConfig`。
5. `guardedCloseExecutor.ts` 使用 `runtimeConfig`。
6. `closePrecheckGate.ts` 使用 `runtimeConfig`。
7. `capitalPrecheck.ts` 使用 `runtimeConfig.capital`。
8. `orderIntent.ts` 使用 `runtimeConfig.featureFlags`。

**依赖**：阶段 1。

### 阶段 3：类型化 persistence 行（P1）

1. 新建 `lib/strategy-v121/persistence/repositoryRowTypes.ts` + 辅助函数。
2. 在 `mainnetTinyPreflight.ts` 和 `finalPreExecutionAudit.ts` 中使用 `readTimestamp` / `readString`。
3. 在 `closePlanLedger.ts`、`closeExecutionLedger.ts`、`orderExecutionLedger.ts`、`orderPlanLedger.ts` 中使用行类型。
4. 在 `userStrategySettingsStore.ts`、`opportunityStore.ts`、`opportunityWatcher.ts`、`orderIntent.ts`、`heartbeat.ts`、`preOrderExecutionGate.ts` 中使用行类型。

**依赖**：无（可与阶段 2 并行，但建议在阶段 2 之后避免冲突）。

### 阶段 4：运行时 adapter 与错误类型标准化（P1）

1. 新建 `exchangeError.ts`。
2. 修改 `runtimeAdapterFactory.ts` 私有字段为 `#apiKey/#apiSecret/#passphrase`。
3. 替换所有 `(err as any).code` 为 `createExchangeError` / `getErrorCode`。
4. 修改 `binanceAccountAdapter.ts` 使用 `ExchangeError`。

**依赖**：无。

### 阶段 5：Worker 与市场快照类型（P1）

1. 修改 `workerAutoExecution.ts` 中的 `any` 市场快照访问为 `MarketSnapshot`。
2. 修改 `workerExecutionHelpers.ts` 使用 `AccountBalanceSnapshot` / `AccountPositionSnapshot`。
3. 确保内部函数返回类型为 `MarketSnapshot | undefined`。

**依赖**：阶段 3（因为可能需要读取 repositoryRowTypes）。

### 阶段 6：枚举/状态类型守卫（P1）

1. 在 `domain/types.ts` 增加 `isExchangeId`。
2. 在 `orderIntent.ts` 增加 `isOrderIntentPurpose`。
3. 在 `orderExecutionTypes.ts` 增加 `isOrderExecutionStatus`。
4. 替换 `finalPreExecutionAudit.ts` 中的 `exchange as any` 和 `purpose as any`。
5. 替换 `runtimeAdapterFactory.ts` 中的 `status as any`。
6. 替换 `capitalPlanner.ts` 中的 `"binance" as any`。

**依赖**：阶段 1-2。

### 阶段 7：剩余 `process.env` 收口（P2）

1. `mainnetTinyGate.ts`、`strategyConfig.ts`。
2. `fundingThresholdPolicy.ts`。
3. `shadowAccountService.ts`、`accountAdapterFactory.ts`、`accountSigning.ts`。
4. `masterKey.ts`。
5. `sqliteRepository.ts`、`persistenceMode.ts`、`repositoryFactory.ts`。
6. `worker.ts`、`devToolsGate.ts`。
7. `alertDispatcher.ts` 使用 `alertConfig`。

**依赖**：阶段 1。

### 阶段 8：测试与 CI（P1-P2）

1. 为 `runtimeConfig` 编写测试。
2. 为 `repositoryRowTypes` 辅助函数编写测试。
3. 为 `ExchangeError` 编写测试。
4. 更新现有测试，使用 `resetRuntimeConfig` 替代直接修改 `process.env`。
5. 在 CI 中引入 `@typescript-eslint/no-explicit-any`（先 warn，再逐步 error）。
6. 运行 `npx tsc --noEmit -p tsconfig.json`，目标生产代码零错误。

**依赖**：阶段 1-7。

---

## 6. 风险分析

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| 改动面大 | 中 | 涉及约 45 个文件，容易产生合并冲突。 | 按阶段分 PR；每阶段独立可合并；优先做 P0/P1。 |
| 测试需要大量更新 | 中 | 许多测试直接修改 `process.env`，需改为 `resetRuntimeConfig`。 | 先建 `resetRuntimeConfig` 工具；批量替换测试中的 `process.env.V121_* = x`。 |
| 运行时行为改变 | 低 | 若类型守卫实现错误，可能改变枚举值处理。 | 所有类型守卫必须等价于原逻辑；增加测试覆盖边界值。 |
| 命名冲突 | 低 | `runtimeConfig` 与 `strategyConfig.getConfig()` 可能命名冲突。 | 统一命名：`getRuntimeConfig()` 用于 env，`getConfig()` 保持用于策略运行时。 |
| 配置读取时机 | 中 | 某些代码在运行时动态读取 `process.env`（如 kill switch），但当前实际为持久化存储。 | 明确区分 env 兜底与运行时状态；`killSwitch` 仍优先读 `KillSwitchStore`，env 仅作为 fallback。 |
| 性能影响 | 低 | 统一配置为单例快照，无运行时开销。 | 使用模块级缓存，避免重复读取。 |
| 引入 `bigint` 或 `#private` 语法兼容性问题 | 低 | 项目已使用 TypeScript 5.x，支持 `#private`。 | 确认 `tsconfig.json` target 支持 ES2020+。 |

---

## 7. 验收标准

1. 生产代码中 `as any` 数量从约 78 降至 30 以下（优先清真实交易路径）。
2. 生产代码中 `process.env` 直接访问从约 82 降至 20 以下，且集中在 `config/` 模块。
3. `runtimeAdapterFactory.ts`、`workerAutoExecution.ts`、`finalPreExecutionAudit.ts` 三个双高文件无 `as any`。
4. `runtimeConfig.ts` 覆盖所有当前使用的 `V121_*` 环境变量，并提供 reset 接口供测试使用。
5. 新增 `repositoryRowTypes.ts` 覆盖 `latest_scan`、`worker_heartbeat`、`user_strategy_settings`、`opportunity_alerts`、`*_ledger` 等表。
6. 新增 `ExchangeError` 类型并在 `runtimeAdapterFactory.ts`、`binanceAccountAdapter.ts` 中使用。
7. 738 tests 全部通过；`npx tsc --noEmit -p tsconfig.json` 生产代码无错误。
8. CI 中 `@typescript-eslint/no-explicit-any` 至少设置为 warn。

---

## 8. 附录：环境变量完整清单

### 8.1 策略 / 模式

- `V121_MODE`
- `V121_MAINNET_TINY_ENABLED`
- `V121_CONFIRM_MAINNET_TINY_RISK`
- `V121_LIVE_ENABLED`
- `V121_MAINNET_TINY_DRY_RUN`
- `V121_REAL_ORDER_EXECUTION_ENABLED`（注意：与 `V121_ENABLE_REAL_ORDER_EXECUTION` 命名不一致，需统一）
- `V121_ENABLE_REAL_ORDER_EXECUTION`
- `V121_ENABLE_REAL_CLOSE_EXECUTION`
- `V121_ENABLE_REAL_INTERNAL_TRANSFER`

### 8.2 持久化

- `V121_PERSISTENCE_MODE`
- `V121_SQLITE_PATH`

### 8.3 密钥 / 安全

- `V121_MASTER_KEY`
- `BINANCE_API_KEY`、`BINANCE_API_SECRET`
- `OKX_API_KEY`、`OKX_API_SECRET`、`OKX_PASSPHRASE`
- `HTX_API_KEY`、`HTX_API_SECRET`
- `V121_SHADOW_USE_MOCK`

### 8.4 风控 / 资本

- `V121_GLOBAL_RESERVE_RATE`
- `V121_MIN_GLOBAL_RESERVE_USDT`
- `V121_SPOT_BUFFER_RATE`
- `V121_PERP_BUFFER_RATE`
- `V121_ALLOW_AUTO_TRANSFER`
- `V121_AUTO_TRANSFER_MAX_USDT`

### 8.5 告警

- `V121_ALERT_TELEGRAM_BOT_TOKEN`
- `V121_ALERT_TELEGRAM_CHAT_ID`
- `V121_ALERT_EMAIL_SMTP_HOST`
- `V121_ALERT_EMAIL_SMTP_PORT`
- `V121_ALERT_EMAIL_USER`
- `V121_ALERT_EMAIL_PASS`
- `V121_ALERT_EMAIL_TO`
- `V121_ALERT_EMAIL_FROM`

### 8.6 其他

- `V121_KILL_SWITCH`
- `V121_MAX_DYNAMIC_SYMBOLS_PER_EXCHANGE`
- `V121_ENABLE_DEV_TOOLS`
- `V121_TEST_FUNDING_THRESHOLD_ENABLED`
- `V121_TEST_FUNDING_THRESHOLD_8H`

### 8.7 命名不一致问题

当前代码中同时存在：
- `V121_REAL_ORDER_EXECUTION_ENABLED`（在 `mainnetTinyPreflight.ts`、`finalPreExecutionAudit.ts`、`orderIntent.ts`）
- `V121_ENABLE_REAL_ORDER_EXECUTION`（在 `runtimeAdapterFactory.ts`、`binanceAccountAdapter.ts`、`okxAccountAdapter.ts`、`guardedOrderExecutor.ts`）

**建议**：在 `runtimeConfig.ts` 中统一读取两者，任意一个为 `"true"` 或 `"1"` 即视为启用，但文档中推荐 `V121_ENABLE_REAL_ORDER_EXECUTION`。长期应废弃不一致命名。

---

## 9. 附录：类型守卫设计草案

### 9.1 `isExchangeId`

```typescript
const ALLOWED_EXCHANGES: ExchangeId[] = ["binance", "okx", "htx"];
export function isExchangeId(value: unknown): value is ExchangeId {
  return typeof value === "string" && ALLOWED_EXCHANGES.includes(value as ExchangeId);
}
```

### 9.2 `isOrderIntentPurpose`

```typescript
const ORDER_INTENT_PURPOSES: OrderIntentPurpose[] = ["real_arbitrage", "execution_rehearsal"];
export function isOrderIntentPurpose(value: unknown): value is OrderIntentPurpose {
  return typeof value === "string" && ORDER_INTENT_PURPOSES.includes(value as OrderIntentPurpose);
}
```

### 9.3 `isOrderExecutionStatus`

```typescript
const ORDER_EXECUTION_STATUSES: OrderExecutionStatus[] = [
  "validated", "submitted", "filled", "partial_filled", "failed", "frozen"
];
export function isOrderExecutionStatus(value: unknown): value is OrderExecutionStatus {
  return typeof value === "string" && ORDER_EXECUTION_STATUSES.includes(value as OrderExecutionStatus);
}
```
