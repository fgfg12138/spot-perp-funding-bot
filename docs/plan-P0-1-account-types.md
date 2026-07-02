# Phase: P0.1 — IAccountAdapter 下单方法改为必需

## 范围

将 `IAccountAdapter` 接口中的 4 个 optional 方法改为必需方法，让 TypeScript 类型系统强制每个适配器都实现完整的下单/查询/划转/验单能力。

**不做**：
- 不改动任何 adapter 的具体实现逻辑
- 不改动其他无关的接口或类型

## 任务列表

- [x] 阅读 `accountTypes.ts` 了解当前接口定义
- [x] 去掉 `transferInternal?` 的问号 → 改为 `transferInternal`
- [x] 去掉 `validateOrderPlan?` 的问号 → 改为 `validateOrderPlan`
- [x] 去掉 `submitOrderLeg?` 的问号 → 改为 `submitOrderLeg`
- [x] 去掉 `fetchOrderByClientOrderId?` 的问号 → 改为 `fetchOrderByClientOrderId`
- [x] 跑 `npx vitest run lib/strategy-v121` 确认测试全绿
- [x] 跑 `npx tsc --noEmit -p tsconfig.ci.json` 确认类型检查零错误

## 质量标准

- 所有 vitest 测试通过
- tsc --noEmit 零错误
- 无新引入的 `as any` / 空 `catch {}`

## 确认门禁

- [x] CI 全绿（vitest 532 通过 + tsc 零错误）
- [x] 改动仅限于 `accountTypes.ts` + 6 个实现类的补全 + 调用处守卫移除
- [x] 所有 adapter 已补全必需方法，编译通过

## 变更摘要

```
accountTypes.ts                          — 4 个 optional 改为必需
shadowAccountService.ts                  — MockAccountAdapter 补 3 个方法
runtimeAdapterFactory.ts                 — 3 个 adapter 各补 4 个方法
guardedOrderExecutor.ts                  — 移除 3 处 optional chaining 守卫
guardedCloseExecutor.ts                  — 移除 2 处 optional chaining 守卫
autoTransferExecutor.ts                  — 移除 1 处 optional chaining 守卫
runtimeAdapterFactory.test.ts            — 测试用例适配新接口
```

