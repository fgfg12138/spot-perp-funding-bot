# MAINNET_TINY 最终检查清单

> ⚠️ 没有项目方单独批准，不允许真实下单。

## 1. 远程 CI 已通过
```bash
# 确认 GitHub Actions 最新 commit 为绿色
gh run list -L 1
```

## 2. .env.local 不得提交
```bash
git status -- .env.local
# 应显示 "nothing to commit"
```

## 3. API Key 权限检查
- [ ] Binance API Key: 只读 + 交易权限已开，提现权限已关
- [ ] OKX API Key: 只读 + 交易权限已开，提现权限已关
- [ ] HTX: 默认禁用

## 4. 提现权限必须关闭
- [ ] Binance: 提现权限 OFF
- [ ] OKX: 提现权限 OFF

## 5. IP 白名单建议
- [ ] Binance API Key: IP 白名单已配置（推荐）
- [ ] OKX API Key: IP 白名单已配置（推荐）

## 6. SQLite active 检查
```bash
# .env.local 中确认
V121_PERSISTENCE_MODE=sqlite-active
```

## 7. Worker heartbeat 检查
```bash
npm run v121:worker
# 确认 heartbeat 日志正常输出
```

## 8. Latest real market scan 检查
访问 `/v121/opportunities` → 触发扫描 → 确认返回真实行情数据

## 9. Opportunity alert 检查
访问 `/v121/opportunities` → 确认有 S/A 级机会告警

## 10. Dry-run intent 检查
对合格机会生成 dry-run intent → 确认 gateAllowed=true, dryRun=true

## 11. 10U 限额检查
- [ ] 单笔 <= 10 USDT
- [ ] 总暴露 <= 50 USDT
- [ ] 每日 <= 3 笔

## 12. Kill Switch 操作
```bash
GET  /api/v121/risk/kill-switch   # 确认 OFF
POST /api/v121/risk/kill-switch   # 随时可设为 PAUSE_ALL_AUTOMATION
```

## 13. 出问题立即停止
- 组合亏损 >= 0.2% 总权益 → 立即停止
- 账户回撤 >= 3% → 立即停止
- 任一交易所不可用 → 立即停止

## 14. 禁止自动入场
- [ ] `allowAutoEntry: false`

## 15. 禁止 HTX / 小币 / 跨所
- [ ] `allowHtx: false`
- [ ] `allowSmallCaps: false`
- [ ] `allowCrossExchange: false`

## 16. 复盘字段
每次执行后写入数据库 7 张核心复盘表。

## 17. 项目方批准格式
```
本人（项目方）已阅读并确认上述所有检查项。
批准进行 MAINNET_TINY 单笔 10 USDT 手动验证。
了解最大亏损风险为总权益 0.2%。

签名: _______________
日期: _______________
```
