## 项目技术提升

2026-06-29 由 Senior Developer 进行了首次全面代码质量审计和示范重构：

### 关键发现
- `as any` 滥用（103 处）— 类型安全严重缺失
- 空 `catch {}` 吞错误（6 处）— 关键路径数据丢失风险
- 超长函数（8 个 >80 行）— 可维护性差
- `process.env` 直接访问（149 处）— 无统一配置入口
- 测试覆盖好（532 个），但产品代码质量仍有提升空间

### 已交付
- `docs/team-coding-standards.md` — 团队编码规范文档
- `lib/strategy-v121/execution/guardedOrderExecutor.ts` — 示范 PR 重构

---

## 三所实盘执行实施

2026-06-29 P0.1–P0.4 完成：OKX adapter 全部方法从 optional/stub 升级为真正实现。

### P0.1: IAccountAdapter 下单方法改为必需（已完成）
- `accountTypes.ts` — 去掉了 4 个方法的 `?`
- `shadowAccountService.ts` — MockAccountAdapter 补全 3 个方法
- `runtimeAdapterFactory.ts` — 3 个运行时 adapter 各补全 4 个方法
- `guardedOrderExecutor.ts` — 移除 3 处 optional chaining 守卫
- `guardedCloseExecutor.ts` — 移除 2 处 optional chaining 守卫
- `autoTransferExecutor.ts` — 移除 1 处 optional chaining 守卫
- `runtimeAdapterFactory.test.ts` — 适配新接口的测试用例

### P0.2: OKX submitOrderLeg + fetchOrderByClientOrderId（已完成）
- `okxAccountAdapter.ts` 新增 `signedPost()`、完整的 `submitOrderLeg()` 和 `fetchOrderByClientOrderId()`
- 处理了 OKX 符号映射（BTC-USDT ↔ BTC-USDT-SWAP）、精度舍入
- 现货用 `tdMode=cash`，永续用 `tdMode=isolated` + `posSide`

### P0.3: OKX validateOrderPlan（已完成）
- 本地验证 + `POST /api/v5/trade/order-precheck` 交易所预检

### P0.4: OKX transferInternal（已完成）
- OKX 统一账户模式下 spot↔perp 共享账户，无需 API 划转

### 关键决策
- 下单方法不再 optional，所有 adapter 必须实现
- 只读 adapter 的实现方法会在调用时 throw Error
- MockAccountAdapter 返回可用的模拟结果
- HTX 保持 observe-only 策略，下单方法保留 stub
- `preOrderExecutionGate.ts` 第 41 行硬编码只允许 binance，需要 P1 阶段解锁

### 后续计划
- P0.5–0.9: 跳过（HTX observe-only，不阻塞）
- P1.1: ✅ `preOrderExecutionGate` exchange 门禁改为动态 adapter 能力检测 + `fetchLatestPrices` 支持多交易所（已交付）
- P1.2: ✅ `autoTransferExecutor` OKX 门禁解锁——OKX 不再因 exchange 被 blocked，走完整流程由 adapter 的 `transferInternal` 处理（已交付）
- P2: ✅ `guardedOrderExecutor` 硬编码 `if (plan.exchange !== "binance")` 改为 adapter 能力检测——OKX 的 order plan 不再被 blocked（已交付）
- P3: ✅ 平仓链路 exchange 门禁解锁——`closePrecheckGate` + `guardedCloseExecutor` 的硬编码 binance 检查改为白名单（binance|okx），allow OKX 同所平仓（已交付）
- P4: 测试补全（OKX adapter 单元测试 + 独立验证）
