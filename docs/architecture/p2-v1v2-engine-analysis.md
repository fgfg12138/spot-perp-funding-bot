# V1 / V2 评分引擎并存问题分析

> 分析日期：2025-07-17
> 项目：spot-perp-funding-bot (`lib/strategy-v121/`)
> 作者：Bob (Architect)

---

## 1. 文件定位

| 引擎 | 文件路径 | 入口函数 | 风格 |
|------|----------|----------|------|
| **V1 scoring** | `lib/strategy-v121/opportunity/scoring.ts` | `scoreOpportunity()` | 函数式，7 维度 100 分制 |
| **V2 scoringEngineV2** | `lib/strategy-v121/opportunity/scoringEngineV2.ts` | `scoreOpportunityV2()` | 函数式，6 维度 100 分制 |

---

## 2. V1 与 V2 功能对比表

| 对比维度 | V1 (scoring.ts) | V2 (scoringEngineV2.ts) |
|----------|-----------------|------------------------|
| **维度数** | 7 | 6 |
| **总分** | 100 | 100 |
| **① 交易可用性** | 10 分 — 交易状态 + 数据完整性 | ❌ 无 — 移到了硬过滤层 |
| **② 资金费收益** | 20 分 — 线性 0~0.30%，>0.30% 降分 | **30 分** — 分档制（0~0.06% 5 档），阈值更低 |
| **③ 资金费稳定性** | ❌ 无 | **20 分** — 最近 9 次正率 + 连续下降扣分 |
| **④ 基差质量** | 20 分 — 线性 0~1.00%，>1.00% 降分 | **20 分** — 分档线性插值（-0.15%~0.15%+），阈值更细 |
| **⑤ 现货流动性** | 15 分 — 24h 成交额 + 价差 + 盘口深度 | ❌ 合并到盘口深度维度 |
| **⑥ 合约流动性** | 15 分 — 24h 成交额 + 价差 + 盘口深度 | ❌ 合并到盘口深度维度 |
| **⑦ 盘口深度** | ❌ 无独立维度（流动性的子项） | **15 分** — 0.2% 深度倍数，含双边不平衡折扣逻辑 |
| **⑧ 路径稳定性** | 10 分 — 同所/跨所 + HTX 惩罚 | ❌ 无独立维度（含在交易所质量中） |
| **⑨ 波动风险** | ❌ 无 | **10 分** — 24h 波动率分档 |
| **⑩ 交易所质量** | ❌ 无 | **5 分** — Binance=5, OKX=4, 跨所=3/2 |
| **⑪ 风险状态** | 10 分 — 价差 + 标记价偏离扣分 | ❌ 无 |
| **等级划分** | S≥85 / A≥75 / B≥65 / C<65 | S≥80 / A≥70 / B≥60 / C<60 |
| **强制等级** | funding≥0.50% → C 级 | funding≥0.50% → C 级 |
| **输入接口** | `ScoringInput`（依赖 `MarketSnapshot`） | `ScoringV2Input`（依赖 `FundingStabilityData` / `DepthFactor` / `VolatilityData` 等） |
| **输出接口** | `ScoringResult`（含 `ScoreBreakdown`） | `ScoringV2Result`（含 `V2ScoreBreakdown`） |

### 核心差异总结

1. **V2 更强调"资金费质量"**：将资金费拆为"收益"(30分) + "稳定性"(20分) 共 50 分（V1 仅 20 分）
2. **V2 引入波动风险维度**：V1 完全未考虑波动率
3. **V2 维度更细但输入更复杂**：需要 `FundingStabilityData`、`VolatilityData`、`DepthFactor` 等预处理数据
4. **V1 依赖原始行情快照**：输入简单，直接从 `MarketSnapshot` 取值
5. **V2 没有独立的"交易可用性"得分**：该类检查被推到 `hardFiltersV2.ts` 硬过滤层

---

## 3. 调用关系分析（全量引用追踪）

### 3.1 `scoreOpportunity()` (V1) 调用链

```
scoring.ts
  └─ export scoreOpportunity()

被以下文件引用：
  ├─ opportunity/scanner.ts  (第4行 import, 第72行调用)
  │   └─ 在 scanOpportunities() 中对每个路径调用评分
  ├─ api/opportunityService.ts (第3行 import, 第40行调用)
  │   └─ 在 processOpportunity() 中作为独立服务入口调用
  └─ opportunity/scoring.test.ts (第2行 import, 多行调用)
      └─ 单元测试文件

导出情况 (index.ts 第22行):
  export * from "./opportunity/scoring";
  → V1 通过 index.ts 统一导出，对外可见
```

### 3.2 `scoreOpportunityV2()` (V2) 调用链

```
scoringEngineV2.ts
  └─ export scoreOpportunityV2()

被以下文件引用：
  ⚠️ 没有任何文件引用！
  → 唯一出现的地方就是 scoringEngineV2.ts 自身的定义 (第63行)

导出情况 (index.ts):
  ⚠️ 未在 index.ts 中导出！
  → scoringEngineV2.ts 没有被任何 export * 包含
```

### 3.3 V2 配套文件调用链

| V2 文件 | 引用者 | 状态 |
|---------|--------|------|
| `scoringEngineV2.ts` | **无** | ✅ **死代码** |
| `hardFiltersV2.ts` | **无** | ✅ **死代码** |
| `constants.ts` 中的 V2 常量 (`FUNDING_V2`, `SCORE_FUNDING`, `SCORE_BASIS`, `DEPTH_V2`, `SCORE_DEPTH`, `SCORE_VOLATILITY`, `VOLATILITY_FILTERS`, `NET_PROFIT_V2`, `SPREAD_V2`, `CAPITAL_PLANS`, `LIQUIDATION_THRESHOLDS`, `POSITION_LIMITS`, `NEW_LISTING_DAYS` 等) | 仅被 V2 死代码文件引用 | ✅ **死代码常量** |
| `types.ts` 中的 V2 类型 (`FundingStabilityData`, `VolatilityData`, `DepthData`, `V2ScoreBreakdown`, `HardFilterV2Rule`, `HardFilterV2Result`) | 仅被 V2 死代码文件引用 | ⚠️ 可一并清理，但需确认无未来计划 |

---

## 4. 结论

### 4.1 V1 — 活跃在用 ✅

- **`scoreOpportunity()`** 被 `scanner.ts` 和 `opportunityService.ts` 两处业务代码调用
- 有配套单元测试 (`scoring.test.ts`)
- 通过 `index.ts` 统一导出，对外可见
- **是当前策略引擎实际在使用的评分系统**

### 4.2 V2 — 完全死代码 🟥

- **`scoreOpportunityV2()`** 零引用（只有自身定义）
- **`hardFiltersV2()`** 零引用
- 未在 `index.ts` 中导出，外部不可见
- 无单元测试文件
- V2 配套的常量（`FUNDING_V2`, `SCORE_FUNDING`, `SCORE_DEPTH` 等）、类型（`FundingStabilityData`, `V2ScoreBreakdown` 等）仅被 V2 死代码引用

### 4.3 判断依据

| 判断标准 | V1 | V2 |
|----------|----|----|
| 被业务代码引用 | ✅ scanner.ts + opportunityService.ts | ❌ 无 |
| 有单元测试 | ✅ scoring.test.ts | ❌ 无 |
| 被 index.ts 导出 | ✅ | ❌ 未导出 |
| 可独立运行 | ✅ | ❌ 缺少调用者 |

**结论：V2 评分引擎 (`scoringEngineV2.ts`) + V2 硬过滤 (`hardFiltersV2.ts`) 是开发了一半但从未集成上线的死代码。**

---

## 5. 清理建议

### 建议方案：**彻底删除 V2 死代码**

理由：
1. V2 从未集成到实际流程中，零引用
2. V2 的评分逻辑与 V1 差异大（资金费占 50 分 vs V1 的 20 分），直接切换会改变策略行为
3. 保留死代码增加维护负担和认知成本
4. 如果未来需要升级评分引擎，应当基于当前的架构重新设计，而非捡回半成品

### 需要删除/修改的文件清单

#### 删除的文件（共 2 个）

| # | 文件路径 | 说明 |
|---|----------|------|
| 1 | `lib/strategy-v121/opportunity/scoringEngineV2.ts` | V2 评分引擎主文件 |
| 2 | `lib/strategy-v121/opportunity/hardFiltersV2.ts` | V2 硬过滤引擎 |

#### 需要清理的常量（在 constants.ts 中）

以下常量**仅**被 V2 死代码引用，可安全删除：

| 常量名 | 行号范围 |
|--------|---------|
| `V2_ALLOWED_EXCHANGES` | 第10行 |
| `FUNDING_V2` | 第33-48行 |
| `SCORE_FUNDING` | 第53-59行 |
| `SCORE_FUNDING_STABILITY` | 第64-71行 |
| `SCORE_BASIS` | 第76-84行 |
| `DEPTH_V2` | 第89-98行 |
| `SCORE_DEPTH` | 第103-112行 |
| `SCORE_VOLATILITY` | 第117-124行 |
| `VOLATILITY_FILTERS` | 第129-136行 |
| `SPREAD_V2` | 第141-156行 |
| `NET_PROFIT_V2` | 第201-204行 |
| `CAPITAL_PLANS` | 第237-259行 |
| `LIQUIDATION_THRESHOLDS` | 第264-277行 |
| `POSITION_LIMITS` | 第282-293行 |
| `NEW_LISTING_DAYS` | 第298行 |

> ⚠️ **注意**：`SCORE_BASIS` 被 `hardFiltersV2.ts` 引用（也是死代码），如果只删 hardFiltersV2 而保留 `SCORE_BASIS`，则没有其他引用者——所以可以一并删除。
>
> ⚠️ **注意**：删除前需确认 `SCORE_BASIS` 中的 `ELIMINATE_BELOW` 没有被 V1 流程意外依赖（当前 grep 结果为零引用）。

#### 需要清理的类型（在 types.ts 中）

以下类型**仅**被 V2 死代码引用，可安全删除：

| 类型名 | 行号 |
|--------|------|
| `FundingStabilityData` | 第182-195行 |
| `VolatilityData` | 第197-202行 |
| `DepthData` | 第204-209行 |
| `V2ScoreBreakdown` | 第211-219行 |
| `HardFilterV2Rule` | 第223-242行 |
| `HardFilterV2Result` | 第244-249行 |

---

## 6. 删除操作步骤（建议顺序）

```
T01: 删除 scoringEngineV2.ts
     → lib/strategy-v121/opportunity/scoringEngineV2.ts

T02: 删除 hardFiltersV2.ts
     → lib/strategy-v121/opportunity/hardFiltersV2.ts

T03: 清理 constants.ts 中的 V2 常量
     → 删除 V2_ALLOWED_EXCHANGES, FUNDING_V2, SCORE_FUNDING,
       SCORE_FUNDING_STABILITY, SCORE_BASIS, DEPTH_V2, SCORE_DEPTH,
       SCORE_VOLATILITY, VOLATILITY_FILTERS, SPREAD_V2,
       NET_PROFIT_V2, CAPITAL_PLANS, LIQUIDATION_THRESHOLDS,
       POSITION_LIMITS, NEW_LISTING_DAYS

T04: 清理 types.ts 中的 V2 类型
     → 删除 FundingStabilityData, VolatilityData, DepthData,
       V2ScoreBreakdown, HardFilterV2Rule, HardFilterV2Result
```

---

## 7. 备选方案（不推荐）

### 方案 B：保持现状

如果团队有计划在可见未来（1-2 个 sprint 内）基于 V2 重构评分引擎，可以暂时保留。但鉴于：
- V2 输入接口与当前数据流不兼容（需要 `FundingStabilityData` 等预处理）
- V2 未导出、无测试、零引用
- 代码已处于"写了但未用"状态

建议还是删除，未来重构时从 Git 历史找回即可（有完整版本记录）。

### 方案 C：集成 V2 替换 V1

不推荐。V2 评分逻辑与 V1 差异较大，直接切换会导致策略行为突变，应当在充分回测和评审后逐步迁移。

---

## 附录：V1 评分维度一览（当前在用）

| 维度 | 分值 | 说明 |
|------|------|------|
| 交易可用性 | 10 | 交易状态正常 + 数据完整性 |
| 资金费吸引力 | 20 | 8h 等效资金费，0.30% 封顶，超标降分 |
| 可成交基差 | 20 | 入场基差率，1.00% 封顶，超标降分 |
| 现货流动性 | 15 | 24h 成交额 + 价差 + 盘口深度 |
| 合约流动性 | 15 | 24h 成交额 + 价差 + 盘口深度（阈值不同） |
| 路径稳定性 | 10 | 同所/跨所，HTX 惩罚 |
| 风险状态 | 10 | 价差过大扣分 + 标记价偏离扣分 |
| **合计** | **100** | S≥85 / A≥75 / B≥65 / C<65 |
