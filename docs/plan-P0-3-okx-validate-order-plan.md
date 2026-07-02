# Phase: P0.3 — OKX adapter 实现 validateOrderPlan

## 范围

为 OKX 的 `IAccountAdapter` 实现真正的 `validateOrderPlan` 方法，包含本地验证和 OKX order-precheck 端点验证。

## 任务列表

- [x] 阅读 `binanceAccountAdapter.ts` 的 validateOrderPlan 作为参考
- [x] 实现 OKX validateOrderPlan
  - 本地验证：plan status、spotLeg/perpLeg 完整性、基本参数
  - 交易所验证：调用 `POST /api/v5/trade/order-precheck` 做现货验证
- [x] 跑 `npx vitest run lib/strategy-v121` 确认测试全绿（532/532）
- [x] 跑 `npx tsc --noEmit -p tsconfig.ci.json` 确认类型检查零错误

## 质量标准

- [x] 所有 vitest 测试通过
- [x] tsc --noEmit 零错误
- [x] 返回正确的 `{ ok, blockers, warnings, raw }` 结构
- [x] 函数 ≤ 60 行

## 变更文件
- `lib/strategy-v121/account/adapters/okxAccountAdapter.ts`

## 变更摘要
- `validateOrderPlan` 从 stub 实现为完整版本：
  - 本地参数验证（plan status、两腿完整性、数值合理性）
  - 交易所验证：`POST /api/v5/trade/order-precheck` 现货预检
  - 永续本地验证（OKX 暂无 perp 的 order-precheck）
