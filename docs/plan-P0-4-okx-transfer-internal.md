# Phase: P0.4 — OKX adapter 实现 transferInternal

## 范围

为 OKX 的 `IAccountAdapter` 实现真正的 `transferInternal` 方法。

**关键发现**：OKX 统一账户下 spot 和 perp 共享同一交易账户（18），无需 API 划转。
真正的 API 划转（`POST /api/v5/asset/transfer`）用于资金账户（6）和交易账户（18）之间，但系统当前不需要这一场景。

## 任务列表

- [x] 阅读 OKX V5 API 文档，了解 asset transfer 端点
- [x] 阅读 `binanceAccountAdapter.ts` 的 transferInternal 作为参考
- [x] 实现 OKX transferInternal
  - 防护逻辑保持不变（dryRun、环境变量门禁）
  - 实际返回"成功"（统一账户内 spot↔perp 不需要 API 调用）
  - autoTransferExecutor 的 balance_confirmed 流程会验证余额变化
- [x] 跑 `npx vitest run lib/strategy-v121` 确认测试全绿
- [x] 跑 `npx tsc --noEmit -p tsconfig.ci.json` 确认类型检查零错误

## 质量标准

- [x] 所有 vitest 测试通过（532/532）
- [x] tsc --noEmit 零错误
- [x] 返回正确的 `InternalTransferResult` 类型

## 变更文件
- `lib/strategy-v121/account/adapters/okxAccountAdapter.ts`
  - `transferInternal` 从 stub 改为真正的实现
  - 新增 `makeFailedTransfer` helper 函数
