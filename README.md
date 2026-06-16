# spot-perp-funding-bot

V1.2.1 正资金费期现套利系统

## 策略

- 买 USDT 现货 + 空 USDT 本位永续合约
- 只做正资金费机会
- 支持交易所：Binance / OKX / HTX

## Deployment Route

```
READ_ONLY → PAPER → SHADOW → MAINNET_TINY → CONTROLLED_LIVE → WHITELIST_AUTO
```

This project does not use Testnet. Mainnet tiny validation (MAINNET_TINY) replaces
external testnet verification with highly restricted real order placement.

## 安全

- 默认模式 READ_ONLY — 不连接 API Key，不下单
- Kill Switch 阻断所有交易
- 风控优先于收益：硬止损 > 保证金风险 > 短腿修复 > 正常止盈 > 等待资金费 > 新开仓

## 快速开始

```bash
npm ci
npm run dev
```

访问 http://localhost:3000/v121/dashboard

## 环境变量

复制 `.env.example` 到 `.env`，按需配置。
