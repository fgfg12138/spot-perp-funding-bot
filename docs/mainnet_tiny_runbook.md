# MAINNET_TINY 执行手册 (Runbook)

> ⚠️ 没有项目方单独批准，不允许真实下单。

## 1. 前置条件

- M0-M9.3 全部完成且测试通过
- 预飞检查分数 >= 85/100
- `allowedForActualExecution` 必须为 true（当前固定 false，需项目方批准后手动修改）

## 2. API Key 权限

- Binance: 只读 + 交易（禁用提现）
- OKX: 只读 + 交易（禁用提现）
- HTX: 默认禁用

## 3. .env.local 配置

```env
V121_MODE=MAINNET_TINY
V121_MAINNET_TINY_ENABLED=true
V121_CONFIRM_MAINNET_TINY_RISK=I_UNDERSTAND
V121_LIVE_ENABLED=false
V121_KILL_SWITCH=OFF
V121_PERSISTENCE_MODE=sqlite-active
V121_REAL_ORDER_EXECUTION_ENABLED=true
V121_MAINNET_TINY_DRY_RUN=false
```

## 4. SQLite 检查

```bash
node -e "require('better-sqlite3'); console.log('OK')"
```

## 5. Worker 检查

```bash
npm run v121:worker
# 确认 heartbeat 正常
```

## 6. SHADOW 只读检查

访问 `/v121/shadow` → 运行只读诊断 → 确认三所通过

## 7. 最新扫描检查

访问 `/v121/opportunities` → 触发扫描 → 确认有数据

## 8. 机会告警检查

访问 `/v121/opportunities` → 查看是否有 S/A 级机会

## 9. Dry-run Intent 检查

对合格机会生成 dry-run intent → 确认 blockedReasons 为空

## 10. 10U 手动确认流程

1. 确认机会满足所有限制
2. 输入确认短语: `I_UNDERSTAND_MAINNET_TINY_10U`
3. 生成 intent → 确认 gateAllowed=true
4. 手工确认后执行

## 11. Kill Switch 操作

```
GET  /api/v121/risk/kill-switch  → 查看状态
POST /api/v121/risk/kill-switch  → 设置状态
  - OFF: 正常
  - PAUSE_NEW_ENTRIES: 暂停新开仓
  - PAUSE_ALL_AUTOMATION: 暂停全部
```

## 12. 事故处理

1. 立即设置 Kill Switch → PAUSE_ALL_AUTOMATION
2. 检查持仓: `/v121/positions`
3. 检查风控: `/v121/risk-center`
4. 如需平仓: 手动操作

## 13. 停止条件

- 组合亏损 >= 总权益 0.2%
- 账户回撤 >= 3%
- 任一交易所不可用
- funding 转负
- 连续 3 次意图被 blocked

## 14. 禁止事项

- 禁止超过 10 USDT 单笔
- 禁止超过 50 USDT 总暴露
- 禁止 HTX
- 禁止小币种
- 禁止跨所
- 禁止自动开仓
- 禁止跳过手动确认

## 15. 复盘字段

每次执行后写入 `final_reviews` 表。
