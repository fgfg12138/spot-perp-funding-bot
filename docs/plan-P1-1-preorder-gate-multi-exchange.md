# Phase: P1.1 — preOrderExecutionGate 多交易所支持

## 范围

让 `preOrderExecutionGate` 从硬编码只支持 Binance 改为支持 OKX 和 Binance。

**不做**：
- 不触碰 HTX（observe-only）
- 不修改 autoTransferExecutor 的 gate（后续阶段）
- 不改变安全策略

## 任务列表

- [ ] 给 `OkxPublicAdapter` 添加 `fetchTickerSpot` 方法
- [ ] 重写 `preOrderExecutionGate` 的 `fetchLatestPrices` 以支持多交易所
- [ ] 修改 `preOrderExecutionGate` 第 41 行 exchange gate 为动态检测
- [ ] 跑 `npx vitest run lib/strategy-v121` 确认测试全绿
- [ ] 跑 `npx tsc --noEmit -p tsconfig.ci.json` 确认类型检查零错误

## 质量标准

- [ ] 所有 vitest 测试通过
- [ ] tsc --noEmit 零错误
- [ ] OKX exchange 传入 preOrderExecutionGate 不再被"不支持订单计划"阻止

## 变更文件
- `lib/strategy-v121/market/adapters/okxPublicAdapter.ts`
- `lib/strategy-v121/execution/preOrderExecutionGate.ts`
