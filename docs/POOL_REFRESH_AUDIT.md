# 币池刷新质量审计报告

> 审查时间：2026-06-30
> 审查范围：marketRefreshService → universeDiscovery → publicAdapter → dataFreshness
> 审查人：Senior Developer

---

## 总体评价

| 维度 | 评级 | 说明 |
|------|------|------|
| ⚡ **快** — 并发与延迟 | **B** | 并发方向对，但存在 `Promise.all` + `for` 双循环串行瓶颈 |
| 👍 **好** — 代码质量 | **B+** | 架构清晰、模块分离好，但有一个严重数据源错误 |
| 🎯 **准** — 数据准确性 | **B−** | 发现了 **1 个严重 BUG** + 2 个关键风险 |
| 🛡️ **健壮性** | **B** | 错误处理完整、缓存降级设计好 |
| 🧪 **测试覆盖** | **A−** | adapter 单元测试完善，但集成测试空白 |

---

## ❌ 发现的问题（按严重度排序）

### 🔴 P0-BUG：现货行情数据源错误

**位置**: `marketRefreshService.ts` 第 91 行

```typescript
// 当前代码（错误！）
const ticker = await adapter.fetchTicker(item.spotSymbol);   // 走的是 fapi（永续）！！！
const ob = await adapter.fetchOrderBook(item.spotSymbol, 10); // 走的也是 fapi 盘口！！！

// 实际应该为
const ticker = await adapter.fetchTickerSpot(item.spotSymbol);   // 现货 ticker
const ob = await adapter.fetchOrderBookSpot(item.spotSymbol, 10); // 现货盘口
```

**后果**:
- 现货 snapshot 的 `bid1/ask1/volume24hUsdt` 数据来自 **永续合约行情**
- 资金费率套利的核心参数之一**基差**(`spotPrice - markPrice`) 计算用的是两个永续价格相减 → **基差恒为零或极窄**，评分引擎永远评不高
- `volume24hUsdt` 用永续的成交量代替现货 → 硬过滤中的 `minSpotVolume24hUsdt` 检查形同虚设
- **Binance** 永续符号格式 (`BTCUSDT`) 与现货相同，这个 bug 对 Binance 有影响但难发现
- **OKX** 符号不同（现货 `BTC-USDT` vs 永续 `BTC-USDT-SWAP`），但 adapter.fetchTicker 内部只接收一个参数不区分，实际调的是 `fapi/v1/ticker/24hr` 返回永续数据

**影响范围**: 所有 spot snapshot — 基差、深度、成交量全部不准确

**修复方案**: 在 `marketRefreshService.ts` 中，spot 调用改为 `fetchTickerSpot` + `fetchOrderBookSpot`。
再进一步，更好的设计是让 `IPublicAdapter` 统一接口，调用方不用区分 spot/perp：

```typescript
// 方案 A — 快速安全（5 分钟改完）
try {
  const ticker = await adapter.fetchTickerSpot(item.spotSymbol); // ← 改这里
  const ob = await adapter.fetchOrderBookSpot(item.spotSymbol, 10); // ← 改这里
  // ...
}

// 方案 B — 架构优化，推荐
// 在 IPublicAdapter 上添加统一的 refresh(symbol, type) 方法
```

---

### 🟡 P1-风险：无速率限制

**位置**: `marketRefreshService.ts` 第 109 行

```typescript
await Promise.all(tasks);  // maxPerEx = 50，即 50 个币同时发请求
// 每个币 2 次 ticker + 2 次 orderbook + 1 次 funding = 5 个 HTTP 请求
// 50 个币 = 250 个并发 HTTP 请求！！！
```

**后果**:
- Binance/OKX 对同一 IP 的并发限制通常几十~几百，250 个并发请求可能触发 **429 Rate Limit**，导致全批失败
- 没有重试逻辑：单次失败直接跳到 error 数组，不影响其他币但该币本轮无数据

**建议**: 添加 `p-limit` 或内置并发控制，限制并发数到 10~15 个：

```typescript
import pLimit from "p-limit";
const limit = pLimit(10);  // 最多 10 个并发
const tasks = items.map(item => limit(async () => { ... }));
```

---

### 🟡 P2-风险：HTX 被静态遗漏

`marketRefreshService.ts` 第 86 行硬编码 `["binance", "okx"]`，HTX 的数据完全不刷新。虽然 HTX 是 observe-only 策略，但 HTX 的行情仍然可以用来做**跨所监控**（比如发现 Binance 和 HTX 之间出现大基差时报警）。

建议：把 HTX 加入刷新循环，即使不执行交易。

---

## ✅ 做得好（表扬）

### 1. 动态币池发现 — 优秀
`universeDiscovery.ts` 从交易所实时拉取交易对，筛选 USDT 计价 + 交易中 + 同时支持 spot 和 perp 的币种。不用手动维护币列表。还带 10 分钟缓存 + 失败降级到上次缓存数据。

### 2. 并行执行 — 方向正确
使用 `Promise.all` + `Promise.allSettled` 在多个维度并行，减少了总耗时。

### 3. 错误隔离 — 优秀
单个币获取失败不会影响其他币，错误信息收集到 errors 数组统一返回。获取 funding 失败也用 `try/catch {}` 静默处理，不影响 snapshot 构建。

### 4. 数据新鲜度检查 — 良好
`dataFreshness.ts` 有 10s 过期阈值检查，有 spread 检查，有 snapshot 字段完整性检查。测试覆盖也够。

### 5. 优先级排序 — 合理
`marketRefreshService.ts` 第 74-78 行对 eligible 列表进行了三次排序：白名单优先 → tiny 优先 → 字母序。这样确保小币不会挤占主流币的数据刷新位置。

### 6. 合约规格模块化 — 好
`contractSpec.ts` 用 Record 做已知币的规格查表，未知币自动填充默认值。`isSmallCoin` 用于识别 1000x 合约币，方便过滤。

---

## 📊 性能分析

### 当前瓶颈

| 阶段 | 耗时估计 | 说明 |
|------|---------|------|
| universeDiscovery 发现 | ~500ms | 2 次 exchangeInfo 请求（并行） |
| 数据刷新（50 币 × 2 所） | ~2-5s | 全并发但受网络和限速影响 |
| scanOpportunities | ~10ms | 纯内存计算 |
| 持久化写入 | ~5ms | SQLite 写入 |
| **总计** | **~2.5-5.5s** | **对 1 分钟轮询周期来说偏长** |

### 优化建议

| 优化项 | 预期效果 |
|--------|---------|
| 添加并发控制（p-limit 10） | 避免 429，但 50 币串行化到 ~10 个并发，总时间增加约 30% |
| 拆分为 2 轮（数据刷新 → 计算） | 让主循环先收集数据再计算，每轮更轻量 |
| 增量更新（只刷上次失败/过期的） | 大幅减少网络请求 |
| 使用 WebSocket（不紧急） | 实时推送而非轮询 |

---

## 🧪 测试覆盖缺口

| 待测试 | 影响 |
|-------|------|
| marketRefreshService 集成测试（mock adapter 验证 spot 用 spotEndpoint） | 高 — 当前只有一个基础测试 |
| universeDiscovery 实际 API 集成测试 | 中 — 当前全是 mock |
| Redis/in-memory 缓存侵入测试 | 低 — 缓存逻辑简单 |
| 高并发场景下的 429 容错测试 | 中 |

---

## 总结

```
⚡ 快: B     — 并发方向对，但可能被 429 限速拖慢
👍 好: B+   — 架构清晰，模块化好，有一个严重 BUG 扣分
🎯 准: B−   — 有一个 P0 级现货/永续数据混淆 BUG + 基差始终失真
🛡️ 稳: B    — 错误处理完整，缓存在线，降级逻辑好
```

**最迫切的事**：修复 P0 BUG — `marketRefreshService.ts` 中现货行情错误调用了永续数据源。这个 bug 让整个"基差"维度的评分失去了意义。
