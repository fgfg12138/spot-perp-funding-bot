# OKX 运行时 Adapter 完整实现 — 完成

## 改动摘要

### 1. `runtimeAdapterFactory.ts` — OKX runtime adapter 全面升级

将 `OkxRuntimeReadAdapter`（只读桩，所有执行方法抛错）升级为 `OkxRuntimeAdapter`（完整实现）：

| 方法 | 之前 | 现在 |
|------|------|------|
| `transferInternal` | 抛错 `"不支持内部划转"` | OKX 统一账户逻辑（spot/perp 共享账户，无需 API 划转） |
| `validateOrderPlan` | 返回 `ok=false, blockers:["okx_runtime_read_only"]` | 调用 `/api/v5/trade/order-precheck` 做交易所级验证 |
| `submitOrderLeg` | 抛错 `"submitOrderLeg is not available"` | 完整实现 4 种市价单（spot_buy/perp_short/perp_buy_close/spot_sell） |
| `fetchOrderByClientOrderId` | 抛错 | 通过 `/api/v5/trade/order` 查询并标准化返回 |

同时添加了 OKX helper 函数：`toOkxInstId`、`normalizeAmount`、`normalizeOkxSubmitResponse`、`normalizeOkxOrderResponse`、`makeFailed`、`makeFailedTransfer`、`dryRunResult`。

### 2. `exchangeAccountService.ts` — 新增交易权限探测

`probeAccount()` 流程新增 `attemptProbeTradeCapabilities()` 步骤：
- 调用 `adapter.validateOrderPlan()` 推断 `tradeSpot`/`tradePerp`
- 读取公共 funding rate API 推断 `fundingRate`
- 认证失败（401/403）时保持权限为 false
- Binance 只读 adapter 的 validateOrderPlan 返回 `ok=false` + 只读 blocker → 不会误判

### 安全特性
- 所有下单方法受 `V121_ENABLE_REAL_ORDER_EXECUTION` / `V121_ENABLE_REAL_CLOSE_EXECUTION` 环境变量保护
- dryRun 模式下返回模拟结果
- 建仓/平仓需额外 `explicitConfirm` 确认短语
- 密钥通过 `Object.defineProperty(enumerable: false)` 保护

## 验证结果
- ✅ `npx tsc --noEmit -p tsconfig.ci.json` — 0 errors
- ✅ 63 test files / 682 tests — all passed
