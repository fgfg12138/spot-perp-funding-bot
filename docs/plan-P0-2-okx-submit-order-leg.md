# Phase: P0.2 — OKX adapter 实现 submitOrderLeg

## 范围

为 OKX 的 `IAccountAdapter` 实现 `submitOrderLeg` 方法。

**不做**：
- 不改动其他 adapter
- 不实现 fetchOrderByClientOrderId / transferInternal / validateOrderPlan（后续阶段）
- 不改动门禁文件

## 准备工作
1. 先阅读 `binanceAccountAdapter.ts` 的 `submitOrderLeg` 作为参考 ✅
2. 阅读 OKX API V5 文档了解下单端点 ✅

## 任务列表

- [x] 阅读 `okxAccountAdapter.ts` 当前结构
- [x] 阅读 `binanceAccountAdapter.ts` 的 submitOrderLeg 作为参考
- [x] 实现 `submitOrderLeg`（现货 + 永续合约）
  - 现货下单：`POST /api/v5/trade/order`
  - 永续下单：`POST /api/v5/trade/order`
  - 需要处理：杠杆模式设置、isolated/cross、符号映射（BTC-USDT）
  - 需要处理：精度舍入
- [x] 实现配套的 OKX 签名方法（如果不存在）— 已存在 `signedGet`，新增 `signedPost`
- [x] 跑 `npx vitest run lib/strategy-v121` 确认测试全绿
- [x] 跑 `npx tsc --noEmit -p tsconfig.ci.json` 确认类型检查零错误

## 质量标准

- [x] 所有 vitest 测试通过（532/532）
- [x] tsc --noEmit 零错误
- [x] submitOrderLeg 返回正确的 `ExchangeOrderSubmissionResult` 类型
- [x] 现货和永续两种订单类型都支持

## 确认门禁

- [x] CI 全绿
- [x] 新代码无 `as any` / 空 `catch {}`
- [x] 函数 ≤ 60 行

## 变更摘要

### `okxAccountAdapter.ts`
- 文件头注释更新：从"只读"改为含下单支持
- 新增 import: `PlannedOrderLeg`, `ExchangeOrderSubmissionResult`
- 新增 `signedPost()` 私有方法
- `submitOrderLeg()` 重写为完整实现（4 条分支：spot_buy / perp_short / perp_buy_close / spot_sell）
- `fetchOrderByClientOrderId()` 重写为真正的 API 查询
- 新增 4 个私有 submit helper：`submitSpotBuyMarket`, `submitPerpShortMarket`, `submitPerpBuyCloseMarket`, `submitSpotSellMarket`
- 新增 helper 函数：`toOkxInstId`, `normalizeAmount`, `normalizeOkxSubmitResponse`, `normalizeOkxOrderResponse`, `makeFailed`, `dryRunResult`
