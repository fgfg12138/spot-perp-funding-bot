import type { ExchangeId, MarketSnapshot, RejectReason } from "../domain/types";
import { ALLOWED_EXCHANGES, FUNDING_THRESHOLDS, VOLUME_THRESHOLDS, SPREAD_THRESHOLDS } from "../domain/constants";

export interface HardFilterInput {
  path: { spotExchange: ExchangeId; perpExchange: ExchangeId; symbol: string };
  spotSnapshot: MarketSnapshot;
  perpSnapshot: MarketSnapshot;
  funding8h: number;
  plannedNotional: number;
  isInCooldown: boolean;
  systemHealthy: boolean;
  listedHoursAgo: number;
  perpCanOpen: boolean;
}

export interface HardFilterResult {
  passed: boolean;
  rejectReasons: RejectReason[];
  warnings: string[];
  nextAction: "enter" | "observe" | "reject" | "freeze";
}

/**
 * 硬性淘汰规则引擎
 * 任何一项不通过，整个机会被淘汰
 */
export function evaluateHardFilters(input: HardFilterInput): HardFilterResult {
  const rejectReasons: RejectReason[] = [];
  const warnings: string[] = [];

  // 1. 交易所限制
  if (!ALLOWED_EXCHANGES.includes(input.path.spotExchange)) {
    rejectReasons.push({ rule: "exchange_not_allowed", detail: `现货交易所 ${input.path.spotExchange} 不在允许列表` });
  }
  if (!ALLOWED_EXCHANGES.includes(input.path.perpExchange)) {
    rejectReasons.push({ rule: "exchange_not_allowed", detail: `合约交易所 ${input.path.perpExchange} 不在允许列表` });
  }

  // 2. 系统健康
  if (!input.systemHealthy) {
    rejectReasons.push({ rule: "system_unhealthy", detail: "系统健康检查未通过" });
  }

  // 3. 冷却期
  if (input.isInCooldown) {
    rejectReasons.push({ rule: "cooldown", detail: "该路径处于冷却期" });
  }

  // 4. 交易状态
  if (input.spotSnapshot.tradingStatus !== "trading") {
    rejectReasons.push({ rule: "spot_not_trading", detail: `现货 ${input.path.symbol} 未在交易` });
  }
  if (input.perpSnapshot.tradingStatus !== "trading") {
    rejectReasons.push({ rule: "perp_not_trading", detail: `合约 ${input.path.symbol} 未在交易` });
  }

  // 5. 合约可开仓
  if (!input.perpCanOpen) {
    rejectReasons.push({ rule: "perp_close_only", detail: "合约只减仓不可开仓" });
  }

  // 6. 上线时间
  if (input.listedHoursAgo < 24) {
    rejectReasons.push({ rule: "too_new", detail: `上线不足24小时 (${input.listedHoursAgo.toFixed(1)}h)` });
  }

  // 7. 资金费
  if (input.funding8h < FUNDING_THRESHOLDS.MIN_FUNDING_8H) {
    rejectReasons.push({ rule: "funding_too_low", detail: `funding_8h ${(input.funding8h * 100).toFixed(3)}% < 0.05%` });
  }
  if (input.funding8h > FUNDING_THRESHOLDS.BLACKLIST_FUNDING_8H) {
    rejectReasons.push({ rule: "funding_blacklist", detail: `funding_8h ${(input.funding8h * 100).toFixed(2)}% > 1.00%，默认黑名单` });
  }
  if (input.funding8h > FUNDING_THRESHOLDS.BLOCK_FUNDING_8H) {
    rejectReasons.push({ rule: "funding_extreme", detail: `funding_8h ${(input.funding8h * 100).toFixed(2)}% > 0.50%，禁止新开仓` });
  }

  // 8. 成交额
  if ((input.spotSnapshot.volume24hUsdt ?? 0) < VOLUME_THRESHOLDS.MIN_SPOT_VOLUME_24H) {
    rejectReasons.push({ rule: "spot_volume_too_low", detail: `现货24h成交额 $${(input.spotSnapshot.volume24hUsdt ?? 0).toLocaleString()} < $200k` });
  }
  if ((input.perpSnapshot.volume24hUsdt ?? 0) < VOLUME_THRESHOLDS.MIN_PERP_VOLUME_24H) {
    rejectReasons.push({ rule: "perp_volume_too_low", detail: `合约24h成交额 $${(input.perpSnapshot.volume24hUsdt ?? 0).toLocaleString()} < $1M` });
  }

  // 9. 买卖价差
  if (input.spotSnapshot.spreadRate > SPREAD_THRESHOLDS.MAX_SPOT_SPREAD) {
    rejectReasons.push({ rule: "spot_spread_too_wide", detail: `现货价差 ${(input.spotSnapshot.spreadRate * 100).toFixed(3)}% > 0.10%` });
  }
  if (input.perpSnapshot.spreadRate > SPREAD_THRESHOLDS.MAX_PERP_SPREAD) {
    rejectReasons.push({ rule: "perp_spread_too_wide", detail: `合约价差 ${(input.perpSnapshot.spreadRate * 100).toFixed(3)}% > 0.08%` });
  }

  // 10. 宽价差降级（触发时禁止新开仓）
  if (input.spotSnapshot.spreadRate > SPREAD_THRESHOLDS.WIDE_SPREAD_TRIGGER) {
    rejectReasons.push({ rule: "wide_spread_downgrade", detail: `现货价差 ${(input.spotSnapshot.spreadRate * 100).toFixed(2)}% > 0.30% 触发宽价差降级` });
    warnings.push("宽价差降级触发，禁止新开仓");
  }

  // 11. 盘口深度（需要 orderBook 数据）
  if (input.spotSnapshot.orderBook) {
    const depthCheck = checkSellDepth(input.spotSnapshot.orderBook.asks, input.plannedNotional, 0.003);
    if (!depthCheck.passed) {
      rejectReasons.push({ rule: "spot_depth_insufficient", detail: `现货0.3%卖盘深度 $${depthCheck.available.toFixed(0)} < 计划仓位×3 ($${(input.plannedNotional * 3).toFixed(0)})` });
    }
  }
  if (input.perpSnapshot.orderBook) {
    const depthCheck = checkBuyDepth(input.perpSnapshot.orderBook.bids, input.plannedNotional, 0.003);
    if (!depthCheck.passed) {
      rejectReasons.push({ rule: "perp_depth_insufficient", detail: `合约0.3%买盘深度 $${depthCheck.available.toFixed(0)} < 计划仓位×5 ($${(input.plannedNotional * 5).toFixed(0)})` });
    }
  }

  // 12. Mark Price / Index 极端偏离检测
  if (input.perpSnapshot.markPrice && input.perpSnapshot.indexPrice) {
    const deviation = Math.abs(input.perpSnapshot.markPrice / input.perpSnapshot.indexPrice - 1);
    if (deviation > 0.05) {
      warnings.push(`Mark/Index 偏离 ${(deviation * 100).toFixed(2)}% > 5%，需人工确认`);
    }
  }

  const passed = rejectReasons.length === 0;
  const nextAction = passed ? "enter" : rejectReasons.some(r => r.rule === "system_unhealthy" || r.rule === "funding_blacklist") ? "freeze" : "reject";

  return { passed, rejectReasons, warnings, nextAction };
}

function checkSellDepth(asks: { price: number; qty: number }[], notional: number, depthPercent: number): { passed: boolean; available: number } {
  if (asks.length === 0) return { passed: false, available: 0 };
  const midPrice = asks[0].price;
  const priceLimit = midPrice * (1 + depthPercent);
  let available = 0;
  for (const level of asks) {
    if (level.price > priceLimit) break;
    available += level.price * level.qty;
  }
  const required = notional * 3;
  return { passed: available >= required, available };
}

function checkBuyDepth(bids: { price: number; qty: number }[], notional: number, depthPercent: number): { passed: boolean; available: number } {
  if (bids.length === 0) return { passed: false, available: 0 };
  const midPrice = bids[0].price;
  const priceLimit = midPrice * (1 - depthPercent);
  let available = 0;
  for (const level of bids) {
    if (level.price < priceLimit) break;
    available += level.price * level.qty;
  }
  const required = notional * 5;
  return { passed: available >= required, available };
}
