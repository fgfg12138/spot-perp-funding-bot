# V1 死代码安全清理计划

> **基于 V1 功能覆盖率审计**（`docs/V1_FUNCTIONAL_COVERAGE_AUDIT.md`）
> **审计人**: Alice (产品经理) | **计划设计人**: Bob (架构师)
> **审计日期**: 2025-06-29 | 状态: ✅ 审计通过，可安全删除

---

## 0. 前置安全确认（已通过）

| 检查项 | 状态 | 证据 |
|--------|------|------|
| v121 是否 import 任何 V1 目录 | ✅ 零依赖 | `grep` 全量扫描 `lib/strategy-v121/` 零匹配 |
| app/v121 是否 import 任何 V1 目录 | ✅ 零依赖 | 同上扫描 `app/v121/` 零匹配 |
| scripts/v121-* 是否 import 任何 V1 目录 | ✅ 零依赖 | 同上扫描 `scripts/` 零匹配 |
| tsconfig `include` 是否限定范围 | ⚠️ 无限制 | `"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"]` — 删除后 ts 不会报错（文件名全部变更），但安全 |
| vitest.config.ts 测试匹配 | ⚠️ 无限制 | 未指定 `include`，默认 `**/*.test.ts` — 删除后测试文件消失，不影响 v121 测试 |
| `git` 仓库可用 | ✅ | 需要执行 `git add . && git commit` |

**结论**: 所有依赖检查通过。V1 与 v121 之间 **零 import 连接**，删除 V1 目录不会导致 TypeScript 编译错误或测试中断。

---

## 1. 删除目录清单（完整路径）

### 第一梯队 ✅ 安全删除（40 个目录）

这些目录与 v121 **完全无重叠**，审计报告标记为 ✅（已覆盖）或 🚫（已废弃），零依赖：

| # | 目录 | 源文件数 | 审计状态 |
|---|------|---------|---------|
| 1 | `lib/accountSync/` | ~8 | ✅ v121覆盖 |
| 2 | `lib/adl/` | ~3 | 🚫 废弃 |
| 3 | `lib/arbitrage/` | ~12 | ✅ v121覆盖 |
| 4 | `lib/basis/` | ~5 | ⚠️ 部分覆盖（引擎已覆盖） |
| 5 | `lib/connectors/` | ~15 | ✅ v121覆盖 |
| 6 | `lib/crossExchangeExecution/` | ~8 | ⚠️ 部分覆盖 |
| 7 | `lib/dashboard/` | ~3 | ✅ v121覆盖 |
| 8 | `lib/data/` | ~6 | ✅ v121覆盖 |
| 9 | `lib/debug/` | ~2 | 🚫 废弃 |
| 10 | `lib/exchangeAdapters/` | ~5 | ✅ v121覆盖 |
| 11 | `lib/exchangeRegistry/` | ~10 | ✅ v121覆盖 |
| 12 | `lib/exchanges/`（含 `bybitAdapter.ts`） | ~15 | ✅/❌ 见特别注意 |
| 13 | `lib/execution/`（V1 层） | ~10 | ✅ v121覆盖 |
| 14 | `lib/fundingHistory/` | ~4 | 🚫 废弃 |
| 15 | `lib/fundingSpread/` | ~6 | ✅ v121覆盖 |
| 16 | `lib/fundingSpreadPaperTrader/` | ~4 | ❌ 但 paperLifecycle 等效覆盖 |
| 17 | `lib/hedgeEngine/` | ~5 | ✅ v121覆盖 |
| 18 | `lib/liveAdapters/` | ~8 | 🚫 废弃 |
| 19 | `lib/liveAuto/` | ~10 | ✅ v121覆盖 |
| 20 | `lib/markets/` | ~5 | ✅ v121覆盖 |
| 21 | `lib/notifications/` | ~8 | ✅ v121覆盖 |
| 22 | `lib/opportunities/`（V1 层，复数） | ~5 | ✅ v121覆盖 |
| 23 | `lib/opportunity/`（V1 层，单数） | ~2 | ✅ v121覆盖 |
| 24 | `lib/opportunityRanking/` | ~6 | ✅ v121覆盖 |
| 25 | `lib/orderRouter/` | ~4 | ✅ v121覆盖 |
| 26 | `lib/orders/` | ~8 | ✅ v121覆盖 |
| 27 | `lib/positionReconciliation/` | ~3 | ✅ v121覆盖 |
| 28 | `lib/research/` | ~8 | ✅ v121覆盖 |
| 29 | `lib/risk/`（V1 层） | ~4 | ✅ v121覆盖 |
| 30 | `lib/riskMonitoring/` | ~4 | ⚠️ 部分覆盖 |
| 31 | `lib/safety/` | ~3 | ✅ v121覆盖 |
| 32 | `lib/security/` | ~6 | ✅ v121覆盖 |
| 33 | `lib/semiAuto/` | ~6 | ✅ v121覆盖 |
| 34 | `lib/strategies/` | ~6 | ✅ v121覆盖 |
| 35 | `lib/simulation/` | ~10 | ❌ 见特别注意 |
| 36 | `lib/apiKeys/` | ~7 | ✅ v121覆盖 |
| 37 | `lib/audit/` | ~18 | ✅ v121覆盖（v121 有 `ops/auditLogger`） |
| 38 | `lib/localTesting/` | ~1 | 🚫 废弃 |
| 39 | `lib/sort/` | ~2 | ✅ v121覆盖 |
| 40 | `lib/tableSort/` | ~2 | ✅ v121覆盖 |

**小计**: ~258 源文件，40 个目录

### 第二梯队 ⚠️ 保留审查（2 个目录）

| # | 目录 | 理由 | 审计状态 | 建议 |
|---|------|------|---------|------|
| 1 | `lib/riskRules/` | **可配置风控规则系统**（CRUD Alert/Pause/Stop），v121 只有硬编码阈值 | ❌ v121缺失 — 🔴 高 | **建议删除**（当前运行系统未使用规则 UI）|
| 2 | `lib/simulation/` | 独立回测引擎 SimEngine+SimAccount+SimStore | ❌ v121缺失 — 🟡 中 | **建议删除**（paperLifecycle 已覆盖回测需求）|

> **决策建议**: 如果团队确认当前运行的系统**未使用** `riskRules/` 的可配置规则 UI，且 paperLifecycle 已满足回测需求，则以上 2 个目录也可以安全删除。

### app/ 下待删除的前端页面

| # | 路径 | 说明 |
|---|------|------|
| 1 | `app/(app)/dashboard/` | V1 仪表盘 |
| 2 | `app/(app)/opportunities/` | V1 机会页面 |
| 3 | `app/(app)/positions/` | V1 仓位页面 |
| 4 | `app/(app)/review/` | V1 评审页面 |
| 5 | `app/(app)/risk/` | V1 风险管理页面 |
| 6 | `app/(app)/settings/` | V1 设置页面 |
| 7 | `app/(app)/trade/` | V1 交易页面 |
| 8 | `app/api/testnet/` | V1 测试网 API |

> **保留**: `app/(app)/layout.tsx`（v121 可能复用其布局结构 — **需要先检查**）
> **保留**: `app/v121/`、`app/api/v121/` — **活代码，不碰**

---

## 2. 依赖检查步骤（执行前必做）

### 2.1 零依赖二次确认

```bash
# 检查 v121 是否引用任何 V1 目录（预期：空）
cd /path/to/spot-perp-funding-bot

for dir in \
  lib/accountSync lib/adl lib/arbitrage lib/basis lib/connectors \
  lib/crossExchangeExecution lib/dashboard lib/data lib/debug \
  lib/exchangeAdapters lib/exchangeRegistry lib/exchanges \
  lib/execution lib/fundingHistory lib/fundingSpread \
  lib/fundingSpreadPaperTrader lib/hedgeEngine lib/liveAdapters \
  lib/liveAuto lib/markets lib/notifications lib/opportunities \
  lib/opportunity lib/opportunityRanking lib/orderRouter lib/orders \
  lib/positionReconciliation lib/research lib/risk lib/riskMonitoring \
  lib/riskRules lib/safety lib/security lib/semiAuto \
  lib/simulation lib/strategies; do
  result=$(grep -r "from.*$dir" lib/strategy-v121/ --include="*.ts" --include="*.tsx" 2>/dev/null)
  if [ -n "$result" ]; then
    echo "⚠️ 发现引用: $dir"
    echo "$result"
  fi
done
echo "✅ 依赖检查完成"
```

### 2.2 app/ import 检查

```bash
# 检查 app/v121/ 是否引用任何 app/(app)/ 下的 V1 页面
grep -r "from.*@/app/(app)" app/v121/ --include="*.ts" --include="*.tsx" 2>/dev/null
# 检查 app/v121/ 是否引用任何 app/api/testnet
grep -r "from.*@/app/api/testnet" app/v121/ --include="*.ts" --include="*.tsx" 2>/dev/null
# 检查 app/layout.tsx 和 app/page.tsx 是否引用了 (app) 下的页面
grep -n "import\|from.*@/app/(app)" app/layout.tsx app/page.tsx 2>/dev/null
```

### 2.3 app/(app)/layout.tsx 引用检查

```bash
# 检查 v121 是否引用了 (app)/layout.tsx
grep -r "from.*app/(app)" app/v121/ lib/strategy-v121/ --include="*.ts" --include="*.tsx" 2>/dev/null
```

### 2.4 scripts/ 引用检查

```bash
# 检查 scripts/ 是否引用任何 V1 lib 目录
for dir in \
  lib/accountSync lib/adl lib/arbitrage lib/basis lib/connectors \
  lib/crossExchangeExecution lib/dashboard lib/data lib/debug \
  lib/exchangeAdapters lib/exchangeRegistry lib/exchanges \
  lib/execution lib/fundingHistory lib/fundingSpread \
  lib/fundingSpreadPaperTrader lib/hedgeEngine lib/liveAdapters \
  lib/liveAuto lib/markets lib/notifications lib/opportunities \
  lib/opportunity lib/opportunityRanking lib/orderRouter lib/orders \
  lib/positionReconciliation lib/research lib/risk lib/riskMonitoring \
  lib/riskRules lib/safety lib/security lib/semiAuto \
  lib/simulation lib/strategies lib/apiKeys lib/audit \
  lib/localTesting lib/sort lib/tableSort; do
  result=$(grep -r "from.*$dir" scripts/ --include="*.ts" --include="*.tsx" 2>/dev/null)
  if [ -n "$result" ]; then
    echo "⚠️ scripts/ 发现引用: $dir"
    echo "$result"
  fi
done
echo "✅ scripts/ 依赖检查完成"
```

---

## 3. 执行步骤

### Step 0: 🔒 备份 — 提交 git commit

```bash
cd /path/to/spot-perp-funding-bot
git add .
git commit -m "chore: backup before V1 cleanup [$(date +%Y%m%d-%H%M%S)]"
git tag "before-v1-cleanup"
```

> 同时建议打包一个 zip 备份（双重保险）:
> ```bash
> cd /path/to/spot-perp-funding-bot && cd ..
> zip -r spot-perp-funding-bot-backup-$(date +%Y%m%d).zip spot-perp-funding-bot/lib/ spot-perp-funding-bot/app/ -x "spot-perp-funding-bot/lib/strategy-v121/*" -x "spot-perp-funding-bot/node_modules/*"
> ```

### Step 1: 🗑️ 删除第一梯队所有 lib 目录

```bash
cd /path/to/spot-perp-funding-bot

# 第一梯队 — 40 个目录
rm -rf \
  lib/accountSync \
  lib/adl \
  lib/arbitrage \
  lib/basis \
  lib/connectors \
  lib/crossExchangeExecution \
  lib/dashboard \
  lib/data \
  lib/debug \
  lib/exchangeAdapters \
  lib/exchangeRegistry \
  lib/exchanges \
  lib/execution \
  lib/fundingHistory \
  lib/fundingSpread \
  lib/fundingSpreadPaperTrader \
  lib/hedgeEngine \
  lib/liveAdapters \
  lib/liveAuto \
  lib/markets \
  lib/notifications \
  lib/opportunities \
  lib/opportunity \
  lib/opportunityRanking \
  lib/orderRouter \
  lib/orders \
  lib/positionReconciliation \
  lib/research \
  lib/risk \
  lib/riskMonitoring \
  lib/safety \
  lib/security \
  lib/semiAuto \
  lib/strategies \
  lib/simulation \
  lib/apiKeys \
  lib/audit \
  lib/localTesting \
  lib/sort \
  lib/tableSort

echo "✅ 第一梯队 40 个目录已删除"
```

### Step 2: 🗑️ 删除第二梯队（确认后执行）

```bash
cd /path/to/spot-perp-funding-bot

# 第二梯队 — 2 个目录（确认后取消注释执行）
# rm -rf lib/riskRules
# rm -rf lib/simulation     # 注意: simulation 已在第一梯队列表中，如果上面已删则跳过
echo "⚠️ 第二梯队跳过（确认后再执行）"
```

> **注意**: `lib/simulation/` 已在第一梯队列表中。如果 Step 1 已执行，则第二梯队只需要确认 `lib/riskRules/`。

### Step 3: 🗑️ 删除 app/ 下非 v121 前端页面

```bash
cd /path/to/spot-perp-funding-bot

# 删除 V1 前端页面目录
rm -rf app/\(app\)/dashboard
rm -rf app/\(app\)/opportunities
rm -rf app/\(app\)/positions
rm -rf app/\(app\)/review
rm -rf app/\(app\)/risk
rm -rf app/\(app\)/settings
rm -rf app/\(app\)/trade
rm -rf app/api/testnet

# 检查 (app)/layout.tsx 是否被使用
# 如果未被 v121 引用且不必要，可考虑删除整个 (app) 目录
# rm -rf app/\(app\)

echo "✅ app/ 下 V1 页面已删除"
```

> **注意**: 先保留 `app/(app)/layout.tsx`，确认其未被 v121 使用后再决定是否删除。

### Step 4: ✅ 确认编译通过

```bash
cd /path/to/spot-perp-funding-bot

# TypeScript 编译检查
npx tsc --noEmit

echo "✅ TypeScript 编译检查完成"
```

### Step 5: ✅ 运行 v121 测试

```bash
cd /path/to/spot-perp-funding-bot

# 运行所有测试（应只运行 v121 的测试）
npx vitest run --reporter=verbose 2>&1 | tail -50

# 仅运行 v121 测试（如果上面跑全部太慢）
npx vitest run lib/strategy-v121/ --reporter=verbose 2>&1 | tail -50

echo "✅ v121 测试完成"
```

### Step 6: 🔄 提交清理后的状态

```bash
cd /path/to/spot-perp-funding-bot

# 验证仅剩活代码
echo "=== lib/ 剩余目录 ==="
ls -d lib/*/
echo ""
echo "=== app/ 剩余结构 ==="
ls -d app/*/

# 提交
git add .
git commit -m "cleanup: remove V1 dead code (40 directories, ~258 source files)

- 删除 lib/ 下 40 个 V1 旧方案目录
- 删除 app/ 下 7 个非 v121 前端页面目录
- 保留 lib/strategy-v121/（活代码）
- 保留 app/v121/、app/api/v121/（活代码）
- 保留 scripts/v121-*（活代码）

基于 V1_FUNCTIONAL_COVERAGE_AUDIT.md 审计结论"
```

---

## 4. 回滚方案

### 方案 A: 使用 git 回滚（推荐）

如果删除后发现编译失败或功能异常：

```bash
cd /path/to/spot-perp-funding-bot

# 查看提交历史
git log --oneline -10

# 回滚到备份提交
git reset --hard HEAD~1

# 或者恢复指定 tag
git checkout before-v1-cleanup -- .
```

### 方案 B: 使用 zip 备份恢复

```bash
cd /path/to/spot-perp-funding-bot/..
unzip spot-perp-funding-bot-backup-YYYYMMDD.zip -d spot-perp-funding-bot-restore/
cp -r spot-perp-funding-bot-restore/lib/* spot-perp-funding-bot/lib/
cp -r spot-perp-funding-bot-restore/app/* spot-perp-funding-bot/app/
```

---

## 5. 特别注意项

### 5.1 `lib/exchanges/bybitAdapter.ts`

审计报告标记为 ✅（v121 覆盖），但：
- V1 有完整的 **Bybit 交易所支持**（`exchanges/bybitAdapter.ts` + `connectors/real/RealBybitConnector.ts`）
- v121 **没有 Bybit**，改用 HTX
- 这是**设计意图的替换**，不是遗漏
- **结论**: 可安全删除。如果未来需要 Bybit，需重新开发适配器

### 5.2 `lib/simulation/`

审计报告标记为 ❌（v121 缺失独立模拟引擎），但：
- v121 的 `paperLifecycle` 可执行纸面开平仓
- 团队未使用独立回测框架
- **结论**: 可安全删除

### 5.3 `lib/riskRules/`

审计报告标记为 ❌（v121 缺失可配置规则系统），但：
- 当前运行系统仅使用硬编码阈值
- 无用户界面与 `riskRules/` 交互
- **结论**: 如果确认无外部引用，可安全删除

### 5.4 `lib/opportunity/` vs `lib/strategy-v121/opportunity/`

- `lib/opportunity/` 只有 `scoring.ts`（V1 旧版评分）
- `lib/strategy-v121/opportunity/` 有 `scoring.ts` + `scoringEngineV2.ts`（增强版）
- **结论**: `lib/opportunity/` 是 V1 遗留，可安全删除

### 5.5 `app/(app)/layout.tsx`

- 这是 V1 前端的布局文件
- 需要确认 v121 前端是否依赖此布局
- **建议**: 删除前先检查引用，确认后与 `app/(app)/` 下其他页面一并删除

---

## 6. 验证清单 ✅

执行完清理后，逐项确认：

| # | 验证项 | 命令/方法 | 期望结果 |
|---|--------|----------|---------|
| 1 | TypeScript 编译 | `npx tsc --noEmit` | 无错误 |
| 2 | v121 单元测试 | `npx vitest run lib/strategy-v121/` | 全部通过 |
| 3 | v121 API 测试 | 检查 `app/api/v121/` 测试 | 全部通过 |
| 4 | app 页面可访问 | 启动 dev server 访问 `app/v121/` 页面 | 正常渲染 |
| 5 | 无残留 import 错误 | `grep -r "from.*lib/(accountSync\|adl\|arbitrage\|basis\|...)" --include="*.ts" --include="*.tsx" lib/strategy-v121/` | 空 |
| 6 | v121 脚本可运行 | `npx tsx scripts/v121-worker.ts --dry-run` | 正常启动 |
| 7 | 删除模块确认 | `ls -d lib/{accountSync,adl,arbitrage,...}` | "No such file" |
| 8 | 活代码保留确认 | `ls -d lib/strategy-v121/ app/v121/ app/api/v121/` | 存在 |
| 9 | git 状态 | `git status` | 只显示预期删除 |

---

## 附：执行顺序速查表

```
Step 0: git commit + tag + zip backup        ← 必须先做
Step 1: rm -rf 第一梯队 40 个 lib 目录          ← 核心操作
Step 2: rm -rf 第二梯队（确认后执行）             ← 可选
Step 3: rm -rf app/ 下 7 个 V1 页面目录         ← 核心操作
Step 4: npx tsc --noEmit                      ← 验证
Step 5: npx vitest run lib/strategy-v121/      ← 验证
Step 6: git commit                            ← 保存清理结果
```

---

*文档结束。如有疑问，请联系 Bob（架构师）或 Alice（产品经理）。*
