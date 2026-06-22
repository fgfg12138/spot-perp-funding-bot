# V121 Product User Flow

成品套利工具的用户流程文档。描述普通用户看到的 8 个页面、开发者入口、
后端安全机制如何保留，以及确认串映射表。

## 1. 成品导航（8 页）

所有成品页面位于路由组 `app/(app)/`，由 `app/(app)/layout.tsx` 统一布局。
导航顺序：

| # | 路径 | 页面 | 用途 |
|---|------|------|------|
| 1 | /dashboard | 总览 | 系统状态概览 + "下一步建议" |
| 2 | /opportunities | 机会 | 套利机会三态列表（可开仓/观察中/不符合条件） |
| 3 | /trade/open | 开仓 | 6 步开仓向导 |
| 4 | /positions | 持仓 | 当前持仓监控 |
| 5 | /trade/close | 平仓 | 持仓 + 生成平仓预案 |
| 6 | /risk | 风控 | 风险保护开关 + 暂停保护 |
| 7 | /settings | 设置 | 资金费率阈值/名义/标的/划转/执行参数 |
| 8 | /review | 复盘 | 7 张核心表的执行记录 |

## 2. 开仓向导（/trade/open，6 步）

把后端"Opportunity → Intent → OrderPlan → Spot test → Dry-run → Real exec"
流程包装成普通用户能跟着点的线性向导：

| 步骤 | 用户动作 | 后端调用 | 通过条件 |
|------|----------|----------|----------|
| ① 选择可执行机会 | 单选一个 intent | GET /api/v121/mainnet-tiny/intents | purpose=real_arbitrage & !simulationOnly & realTradeEligible=true |
| ② 准备资金（可选） | 跳过或划转 | — | 可直接跳过（自动划转方案未启用） |
| ③ 生成开仓方案 | 点击"生成开仓方案" | POST /api/v121/mainnet-tiny/order-plan | orderPlan.status === validated 且有 spotLeg/perpLeg |
| ④ 交易所参数校验 | 点击"开始校验" | POST /api/v121/mainnet-tiny/order-plan/test | result.ok === true |
| ⑤ 执行前校验 | 点击"执行前校验" | POST /api/v121/mainnet-tiny/order-execution (dryRun:true) | result.status === dry_run |
| ⑥ 确认开仓 | 输入 CONFIRM_OPEN_POSITION | POST /api/v121/mainnet-tiny/order-execution (dryRun:false, explicitConfirm:EXECUTE_REAL_TWO_LEG_ORDER) | result.status === filled |

每步通过前，下一步按钮禁用。Step ⑥ 的真实开仓按钮在 Step ⑤ 通过前始终禁用。

## 3. 平仓流程（/trade/close）

真实平仓后端属 Task P2，当前未实现。成品页只提供"生成平仓预案"：

1. 持仓列表展示币种/路径/数量/偏差/状态。
2. 每行一个"生成平仓预案"按钮 → `POST /api/v121/positions/[id]/close-preview`。
3. 服务器端（纯函数 + 币安公共行情，无需 API key）计算：
   - 平仓可成交基差 = 合约卖一 / 现货买一 - 1
   - 累计已实现资金费（funding_settlements.received）
   - 预估基差利润 / 手续费 / 净收益
   - 调用 `shouldExitPosition` 得出平仓建议（建议平仓/建议持有 + 优先级）
4. 预案明确标注 **"平仓预案，未执行真实下单。"**
5. 不提供"确认平仓"按钮；用户参考预案自行在交易所操作。

约束：仅币安路径生成预案；其它路径返回 supported=false 并提示。

## 4. 开发者入口

开发者页面保留在 `app/v121/`，由 `app/v121/layout.tsx` 的 `notFound()` 守卫门控：

```
if (process.env.V121_ENABLE_DEV_TOOLS !== "1") notFound();
```

- `V121_ENABLE_DEV_TOOLS` 是构建期 env（`next build` 时内联）。
- 生产构建默认不带此变量 → `/v121/*` 全部 404，成品导航不显示开发者入口。
- 设为 `1` 时：成品导航下方出现"开发者"行，含 4 个入口。

| 开发者页面 | 路径 | 用途 |
|---|---|---|
| 执行意图 | /v121/intents | order intent 队列 |
| 只读诊断 | /v121/shadow | shadow account 诊断 |
| 主网小资金 | /v121/mainnet-tiny | 安全门 / preflight / final-audit |
| 实盘前审计 | /v121/mainnet-tiny/final-audit | 上线前审计清单 |

开发者页保留全部工程术语（intent / orderPlan / preflight / dry-run / ledger 等），
不在 lint 拦截范围内。

## 5. 后端安全机制（完全保留不变）

成品化只重写 UI 层，后端安全机制一行未改：

| 机制 | 位置 | 作用 |
|---|---|---|
| 5 档模式门 | lib/strategy-v121 (READ_ONLY/PAPER/SHADOW/MAINNET_TINY/CONTROLLED_LIVE) | 只有 MAINNET_TINY/CONTROLLED_LIVE 才允许真实动作 |
| 环境门 | V121_ENABLE_REAL_INTERNAL_TRANSFER / V121_ENABLE_REAL_ORDER_EXECUTION | 必须为 "1" 才执行真实划转/下单 |
| Intent 门 | order-plan route | 只接受 real_arbitrage + !simulationOnly + realTradeEligible |
| 11-gate 执行器 | guardedOrderExecutor | 11 道闸门，只有币安真实交易实现 |
| Preflight | preOrderExecutionGate | 开仓前系统安全检查 |
| safeExecution | execution/safeExecution | 安全执行包装 |
| Freeze | freezeState | 冻结态阻止所有真实动作 |
| Kill Switch | risk/killSwitch | 风险保护开关，停止新开仓 |
| Ledger | orderPlanLedger / orderExecutionLedger / internalTransferLedger | 不可变执行记录 |
| 确认串 | EXECUTE_REAL_TWO_LEG_ORDER / EXECUTE_REAL_INTERNAL_TRANSFER | 真实动作需显式确认串 |

## 6. 确认串映射表

用户在成品 UI 输入的是产品词；前端验证后映射成后端工程确认串再发送。
工程确认串只出现在 fetch body 中，绝不渲染到界面。

| 用户输入（产品词） | 前端校验 | 发给后端（工程词） | 后端校验 |
|---|---|---|---|
| `CONFIRM_OPEN_POSITION` | 前端 prompt 比对 | `EXECUTE_REAL_TWO_LEG_ORDER` | guardedOrderExecutor 比对 |
| `CONFIRM_TRANSFER` | 前端 prompt 比对 | `EXECUTE_REAL_INTERNAL_TRANSFER` | autoTransferExecutor 比对 |

## 7. 术语映射（工程词 → 产品词）

成品 UI 不可出现工程词，由 `scripts/lint-i18n.mjs`（只扫 `app/(app)/**`）拦截。

| 工程词 | 产品词 |
|---|---|
| dry-run | 执行前校验 |
| OrderPlan | 开仓方案 |
| Intent | 可执行机会 |
| Ledger | 执行记录 |
| Preflight | 系统安全检查 |
| blocked | 暂不可执行 |
| frozen | 已暂停保护 |
| Worker | 后台监控 |
| Kill Switch | 风险保护开关 |

## 8. 旧 URL 兼容

`next.config.ts` 的 `redirects()`（`permanent: false`，避免浏览器缓存）
把旧 `/v121/<产品页>` URL 重定向到新成品路径：

| 旧 URL | 新 URL |
|---|---|
| /v121/dashboard | /dashboard |
| /v121/opportunities | /opportunities |
| /v121/execution | /trade/open |
| /v121/positions | /positions |
| /v121/risk-center | /risk |
| /v121/settings | /settings |
| /v121/review | /review |

注意：`/v121/intents`、`/v121/shadow`、`/v121/mainnet-tiny`、`/v121/mainnet-tiny/final-audit`
是保留的开发者页面，不重定向，由 `V121_ENABLE_DEV_TOOLS` 门控。
