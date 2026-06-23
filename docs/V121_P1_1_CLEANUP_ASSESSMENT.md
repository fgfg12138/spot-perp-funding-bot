# V121 P1.1 — 旧 V1.0 / 开发 API 残留清理评估

> 状态：**仅评估，不删除**。本报告只列清楚每一项残留的去向（删除 / 加 dev 门禁 / 记为内部 / 保留），并标注锁定它的测试与风险。实际删除/改造需另开任务。

## 0. 背景与方法

- P1 产品化已合并（PR #7）。8 个成品页面在 `app/(app)/**`，统一用 `app/(app)/layout.tsx` 的 `PRODUCT_NAV`（总览/机会/开仓/持仓/平仓/风控/设置/复盘）。
- 4 个开发页面在 `app/v121/**`，由 `V121_ENABLE_DEV_TOOLS=1` + `notFound()` 守卫，生产构建默认 404。
- 但 build 产物里仍带着 V1.0 残留：一个旧页面、一组旧 API、一套旧导航组件、若干 V121 工程 API。这些在成品导航里看不到，却仍可通过 URL 直接命中。
- 评估方法：枚举全部 `app/api/**/route.ts`（54 条）+ 全部 `app/**/page.tsx`（14 个）→ grep 找每个残留项的前端调用方 → 读锁定测试并实跑确认现状 → 核实 V1.0 lib 是否被 V121 引用 → 分类。

## 1. 残留分类总表

### A. V1.0 残留页面（成品导航不指向，但 URL 仍可达）

| 项 | 当前调用方 | 锁定测试 | 建议 | 风险 |
|---|---|---|---|---|
| `app/risk-center/page.tsx` | 无导航指向；URL `/risk-center` 直接可达。渲染 `PageShell` → V1.0 `TopNav`（26 条链接，多数指向已不存在的页面） | `tests/riskCenter.test.ts`（✅ 通过） | **dev-gate**（加 `notFound()` 守卫，归入 `V121_ENABLE_DEV_TOOLS`）或**删除** | 删除/门禁都需同步处理 `riskCenter.test.ts` |

### B. V1.0 残留导航组件（成品不渲染，仅 risk-center 用）

| 项 | 当前调用方 | 锁定测试 | 建议 | 风险 |
|---|---|---|---|---|
| `components/ui/dashboard.tsx`（`APP_NAV_ITEMS` 26 条 V1.0 链接） | 仅 `app/risk-center` → `PageShell` → `TopNav` | `components/ui/dashboard.test.ts`（✅ 通过）、`tests/stylePipeline.test.ts`（✅ 通过） | 随 risk-center 一起处理 | `APP_NAV_ITEMS` 里 `/strategies /execution /risk-rules /api-keys` 等目标页面均已不存在 |
| `components/PageShell.tsx` | 仅 `app/risk-center` | — | 随 risk-center 一起处理 | — |
| `components/TopNav.tsx`（re-export） | 仅 `PageShell` | — | 随 risk-center 一起处理 | — |

> 关键事实：成品 8 页用 `(app)/layout.tsx`，**不**导入 `PageShell`/`TopNav`/`APP_NAV_ITEMS`。整条 V1.0 导航链只有 `app/risk-center` 一个消费者。

### C. V1.0 残留 API 路由（成品/开发页面都不调用）

| 路由 | 后端 lib 依赖 | 锁定测试 | 建议 | 风险 |
|---|---|---|---|---|
| `GET /api/summary` | `lib/data/fundingService`（仅 3 个 V1.0 路由用） | 无 | **删除候选** | 低 |
| `GET /api/funding/cross-exchange` | 同上 | 无 | **删除候选** | 低 |
| `GET /api/funding/spot-perp` | 同上 | 无 | **删除候选** | 低 |
| `GET /api/basis/opportunities` | `lib/basis/basisApi`（仅本路由用） | 无 | **删除候选** | 低 |
| `GET /api/opportunities` | `lib/opportunities/opportunitiesApi`（仅本路由用） | 无 | **删除候选** | 低 |
| `POST /api/simulation/run` | `lib/simulation/simService`（仅 3 个 simulation 路由用） | 无 | **删除候选** | 低 |
| `GET /api/simulation/account` | 同上 | 无 | **删除候选** | 低 |
| `GET /api/simulation/history` | 同上 | 无 | **删除候选** | 低 |

> 已核实：`fundingService / simService / opportunitiesApi / basisApi` **不被 `lib/strategy-v121/**` 引用**。删除这 8 条路由对 V121 无影响；是否一并删 V1.0 lib 模块属更深层清理，本评估不覆盖。

### D. `/api/testnet/*` 残留骨架（全部 403，被大量安全边界测试锁定）

| 路由 | 状态 | 锁定测试 | 建议 | 风险 |
|---|---|---|---|---|
| `POST /api/testnet/orders/preview-submit` | 403 blocked | `tests/originalProductPlanClosure.test.ts`（❌ 已失败，但失败原因不是 testnet）、`tests/originalPlanCompletionAudit.test.ts`（❌ 已失败）、`tests/phase5*.test.ts`（✅ 通过，多个）、`tests/phase5RealTestnetDesignBoundary.test.ts` 等 | **保留并记为内部安全边界** | 删除会破坏一整族 phase5 安全边界测试（这些是通过的、有意义的） |
| `POST /api/testnet/orders/cancel` | 403 blocked | 同上 | 同上 | 同上 |
| `GET /api/testnet/orders/[id]` | 403 blocked | 同上 | 同上 | 同上 |
| `GET /api/testnet/account/snapshot` | 403 blocked | 同上 | 同上 | 同上 |
| `app/api/testnet/_shared/blockedResponse.ts` | 共享 helper | 多个 phase5 测试读它 | 随路由保留 | — |

> 这一组是"故意保留的负样本"：证明 testnet 真实下单未开放。建议不动，仅在文档里记为内部安全边界。

### E. V121 开发/工程 API（成品不调用，建议 dev-gate）

| 路由 | 语义 | 锁定测试 | 建议 | 风险 |
|---|---|---|---|---|
| `GET/POST /api/v121/executions/paper` + `/[id]` | Paper 生命周期；AGENTS.md M7 列为开发 API | 无 | **dev-gate** | 低 |
| `GET /api/v121/opportunities/rehearsal-candidate` + `POST /dry-run-intent` | "rehearsal" + "dry-run" | 无 | **dev-gate** | 低 |
| `GET /api/v121/opportunity-alerts` + `POST /[id]/dry-run-intent` | "dry-run" | 无 | **dev-gate** | 低 |
| `GET /api/v121/persistence/status` | 诊断 | 无 | **dev-gate** | 低 |
| `GET /api/v121/opportunities/universe` | universe 配置 | 无 | **dev-gate 或记为内部** | 低 |
| `*/capital-precheck`、`*/constraint-precheck` | 预检 helper | 无 | **dev-gate 或记为内部** | 低 |

> dev-gate 做法：在 route handler 顶部加 `if (process.env.V121_ENABLE_DEV_TOOLS !== "1") return NextResponse.json({ error: "dev only" }, { status: 404 });`，与 `app/v121/layout.tsx` 同一套开关。

### F. V121 SHADOW 诊断子路由（开发页面只用 3 个，4 个未用）

| 路由 | 开发页面调用 | 建议 | 风险 |
|---|---|---|---|
| `GET /api/v121/shadow`、`/shadow/account`、`/shadow/diagnostics` | ✅ `app/v121/shadow` | **保留**（dev 页面用） | — |
| `GET /api/v121/shadow/report`、`/orders`、`/positions`、`/balances` | ❌ | **dev-gate 或记为内部** | 低 |

### G. V121 真实下单子路由（P2 平仓执行器可能用到，一律保留）

| 路由 | 当前调用 | 建议 | 风险 |
|---|---|---|---|
| `POST /api/v121/mainnet-tiny/order-execution` | ✅ `trade/open` ⑥ | **保留** | — |
| `GET /api/v121/mainnet-tiny/order-execution/[id]` | ❌ | **保留**（P2 查询执行状态） | 误删会影响 P2 |
| `POST /api/v121/mainnet-tiny/order-plan`、`/order-plan/test` | ✅ `trade/open` ⑤ | **保留** | — |
| `GET /api/v121/mainnet-tiny/order-plan/[id]` | ❌ | **保留**（P2 可能用） | 误删会影响 P2 |
| `GET /api/v121/mainnet-tiny/intents`、`/gate` | ✅ `trade/open` + dev 页 | **保留** | — |
| `POST /api/v121/mainnet-tiny/intent`（单数） | ❌ | **dev-gate 或保留** | 低 |
| `POST /api/v121/mainnet-tiny/safe-execution` | ❌（前端不直调，是后端安全核） | **保留** | 误删会破坏 `guardedOrderExecutor` 安全链 |
| `GET /api/v121/mainnet-tiny/armed-dry-run` | ❌ | **dev-gate** | 低 |
| `POST /api/v121/mainnet-tiny/auto-transfer` + `/[id]` | ❌ | **保留**（真实划转，P2/运维可能用） | 误删会影响资金调拨 |
| `GET /api/v121/mainnet-tiny/preflight`、`blocked-attempts`、`final-audit` | ✅ dev 页 | **保留** | — |

## 2. 锁定测试现状（已实跑确认）

| 测试文件 | 状态 | 说明 |
|---|---|---|
| `tests/riskCenter.test.ts` | ✅ 通过 | 锁 `app/risk-center/page.tsx` 存在 + 4 个 store import + 无 `fetch(`/axios/decrypt |
| `components/ui/dashboard.test.ts` | ✅ 通过 | 锁 `APP_NAV_ITEMS` 26 条精确数组 |
| `tests/stylePipeline.test.ts` | ✅ 通过 | 锁 `APP_NAV_ITEMS` labels 精确顺序 |
| `tests/originalProductPlanClosure.test.ts` | ❌ **已失败** | 断言 `app/execution`、`app/strategies`、`app/api/strategies/[id]/clone` 存在——这些页面已不存在 |
| `tests/originalPlanCompletionAudit.test.ts` | ❌ **已失败（8 处）** | 断言 `app/strategies`、`app/risk-rules`、`app/api-keys` 存在；且 "no mainnet file" 规则误命中 `lib/strategy-v121/mainnetTiny/*`（合法 V121 文件名） |

实跑结果：`2 failed | 3 passed (5)`，`8 failed | 38 passed (46)`。

> 结论：`npm run test`（全量）**已坏**；`v121:verify` 只跑 `lib/strategy-v121` 所以仍绿。两个 `original*` 测试是 V1.0 遗留、断言已不成立，属于"已坏锁定"——清理它们是修绿，不是引入回归。

## 3. 成品页面实际调用的 API（保留集，供核对）

来自 `app/(app)/**` 的 grep：

```
/api/v121/health          /api/v121/worker          /api/v121/risk
/api/v121/risk/kill-switch
/api/v121/opportunities   /api/v121/opportunities/scan
/api/v121/positions       /api/v121/positions/[id]/close-preview
/api/v121/review          /api/v121/settings
/api/v121/mainnet-tiny/intents   /api/v121/mainnet-tiny/gate
/api/v121/mainnet-tiny/order-plan  /api/v121/mainnet-tiny/order-plan/test
/api/v121/mainnet-tiny/order-execution
```

开发页面 `app/v121/**` 调用：

```
/api/v121/mainnet-tiny/{intents,gate,preflight,blocked-attempts,final-audit}
/api/v121/shadow  /api/v121/shadow/account  /api/v121/shadow/diagnostics
```

以上 22 条为"保留集"，本评估不动。

## 4. 建议执行顺序（P1.1 之后，另开任务做删除/门禁）

1. **先修"已坏锁定"**：删/改 `tests/originalProductPlanClosure.test.ts` + `tests/originalPlanCompletionAudit.test.ts`（它们已失败，清理即修绿全量 test）。
2. **决定 `app/risk-center` 去留**：dev-gate（加 `notFound()`）或删除。任一选择都要同步改 `riskCenter.test.ts` + `dashboard.test.ts` + `stylePipeline.test.ts`（后两者锁 `APP_NAV_ITEMS`）。
3. **删 V1.0 残留 API（C 区 8 条）**：删路由 + 可选删对应 V1.0 lib（单独评估）。
4. **V121 工程 API（E 区）加 dev-gate**：route handler 顶部加 `V121_ENABLE_DEV_TOOLS !== "1"` → 404。
5. **`/api/testnet/*`（D 区）**：保留，仅文档记为内部安全边界。
6. **G 区真实下单子路由**：一律保留，不动。

## 5. 风险与不变量

- 后端安全机制（preflight / safeExecution / orderPlan / guardedOrderExecutor / killSwitch / env 门禁 / 确认串）不动。
- `/api/v121/mainnet-tiny/safe-execution`、`order-execution`、`order-plan`、`auto-transfer`、`gate`、`preflight`、`final-audit` 一律保留——它们是真实下单安全链。
- 删 V1.0 路由不影响 V121：V1.0 lib 不被 `lib/strategy-v121/**` 引用（已核实）。
- 两个 `original*` 测试已失败，删除它们不会引入新回归。

## 6. 本评估不做的事

- 不删除任何文件。
- 不修改任何 route handler。
- 不改任何测试。
- 只产出本报告。
