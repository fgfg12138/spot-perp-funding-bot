# Funding Dashboard — 项目交接文档

## 项目概述

跨交易所资金费率套利监测系统。监控 Binance / OKX / HTX 三交易所 USDT 永续合约的资金费率，发现可套利的 cross-exchange spread。

**只监测，不下单，不调用私有 API。**

---

## Git

```
远程仓库: https://github.com/fgfg12138/funding-dashboard-ds.git
当前分支: main
最后提交: <最后一次 commit SHA>
```

## 目录结构

```
funding-dashboard-main/
├── app/                          # Next.js 前端页面
├── lib/
│   ├── connectors/               # 交易所连接器（只读）
│   │   └── real/
│   │       ├── RealBinanceConnector.ts
│   │       ├── RealOkxConnector.ts
│   │       └── RealHtxConnector.ts
│   ├── fundingSpread/            # 资金费率核心逻辑
│   │   ├── fundingSpreadEngine.ts       # 跨所 spread 计算
│   │   ├── fundingSpreadTypes.ts        # 类型定义
│   │   ├── watcherRunLogger.ts          # 持久化日志记录器
│   │   ├── watcherRunLogger.test.ts
│   │   └── BinanceOkxHtxSpreadWatcherRealtime24h.test.ts  # 24h 实时监控
│   ├── crossExchangeExecution/   # 执行预检 + 门禁
│   │   ├── signalGatedTinyDryRun.ts     # 信号门禁框架
│   │   ├── signalGatedTinyDryRun.test.ts
│   │   ├── watcherSignalIntegration.ts  # watcher 信号 → 门禁
│   │   └── watcherSignalIntegration.test.ts
│   └── ... 其他模块
├── data/
│   └── watcher-runs/             # watcher 运行数据（JSONL 持久化日志）
├── tests/                        # 全库安全审计
└── package.json
```

## 关键文件

| 文件 | 说明 |
|------|------|
| `BinanceOkxHtxSpreadWatcherRealtime24h.test.ts` | 24h watcher 主程序。每 3 分钟扫描 370+ 个币种 |
| `watcherRunLogger.ts` | 持久化日志器。写 6 种文件到 `data/watcher-runs/<runId>/` |
| `signalGatedTinyDryRun.ts` | 门禁框架。7 道门禁，只有 signal_found 才放行 |
| `watcherSignalIntegration.ts` | watcher 报告 → 门禁评估的集成层 |
| `fundingSpreadEngine.ts` | 跨交易所 funding spread 发现引擎 |

## 如何启动 24h Watcher

```bash
# 3 分钟间隔，480 cycles = 24h
RUN_BINANCE_OKX_HTX_SPREAD_WATCHER_REALTIME_24H=true \
npx vitest run lib/fundingSpread/BinanceOkxHtxSpreadWatcherRealtime24h.test.ts \
  --testTimeout=90000000 --reporter=verbose
```

**注意：** 这是 shell 后台进程，shell 关闭后进程会死。需在持久化环境中运行。

## 监控数据

每 3 分钟一个 cycle，每 cycle：

- **858 条** funding snapshot（370+ 币种 × 2-3 交易所）
- **370 条** candidate 评估（含 blockerReason）
- 有 spread 时追加 signals.jsonl

数据路径：`data/watcher-runs/<runId>/`

```
run.json                 # 运行配置
cycles.jsonl             # 每 cycle 一条（JSONL）
funding-snapshots.jsonl  # 每交易所×币种一条
candidates.jsonl         # 每币种一条
signals.jsonl            # 仅 actionable signal 时追加
summary.json             # 运行结束时生成
```

## 测试

```bash
npx vitest run              # 163 suites, 3729 tests
npx next build               # 构建前端
```

## 门禁判断

```typescript
import { evaluateWatcherReportForDryRun } from "./watcherSignalIntegration";

const decision = evaluateWatcherReportForDryRun(watcherReport);
// decision.allowed  → true 可进入 dry run
// decision.status   → "ready_for_dry_run" 或各种 blocked_*
// decision.blockers → 原因列表
```

## 已知问题

1. Watcher 是 vitest 测试进程，不是 daemon。shell/终端关闭后进程终止
2. 断网不会自动重连，需手动重启
3. 当前 370 个币种只做了 ≥2 交易所配对检测，未包含单交易所内套利
