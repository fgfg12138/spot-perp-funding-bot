# Guarded Real Order Execution Runbook

## 1. 功能边界

- 仅支持 **Binance** 同一交易所
- 仅支持 **spot BUY (MARKET) + perp SELL SHORT (MARKET)**
- 第一版只支持 MARKET 订单
- 默认 dry-run，真实执行必须显式确认
- 任何不确定状态立即冻结，不自动补腿或平仓

## 2. 前置条件

执行前必须完成：
1. ✅ Binance 内部划转 dry-run 通过
2. ✅ 生成 validated order plan
3. ✅ Spot test order 校验通过
4. ✅ settings.execution.allowRealOrders=true
5. ✅ V121_ENABLE_REAL_ORDER_EXECUTION=1

## 3. 环境设置

```env
V121_MODE=MAINNET_TINY
V121_ENABLE_REAL_ORDER_EXECUTION=1
```

Settings API：
```json
{
  "execution": { "allowRealOrders": true }
}
```

## 4. 第一笔执行

**第一笔金额只允许 1 USDT（或交易所最小值）。**

1. 生成 order plan
2. 点击 "Spot test order 校验"
3. 点击 "Dry-run 执行双腿下单"
4. 检查结果，确认没有 blocker
5. 点击 "真实执行双腿下单"
6. 输入 `EXECUTE_REAL_TWO_LEG_ORDER`
7. **立刻去 Binance 页面检查现货余额和永续仓位**

## 5. 执行后检查

| 检查项 | 方法 |
|--------|------|
| 现货余额 | Binance 页面 → 钱包 → 现货 |
| 永续仓位 | Binance 页面 → 合约 → USDⓈ-M |
| 订单状态 | GET /api/v121/mainnet-tiny/order-execution |

## 6. Frozen 人工处理

如果系统返回 frozen：

1. **不要自动重试**
2. 去 Binance 页面检查订单状态
3. 如果现货已成交但永续未成交：人工开空或卖出现货
4. 如果永续已成交但现货未成交：买入现货或平空
5. 如果都未成交：检查原因后重试
6. 如果都成交但状态 unknown：以 Binance 页面为准，系统状态可人工修正

## 7. 禁止事项

- ❌ 不自动补腿
- ❌ 不连续开仓
- ❌ 不无人值守
- ❌ 不跨所
- ❌ 不提现
- ❌ 不下 LIMIT 订单（第一版）
- ❌ 不绕过 explicitConfirm
- ❌ 不对 frozen 自动重试
