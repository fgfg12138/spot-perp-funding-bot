/**
 * 开仓可成交基差 = 合约买一价 / 现货卖一价 - 1
 * 用于判断是否值得开仓（买现货、空合约）
 */
export function calcEntryExecutableBasis(perpBid1: number, spotAsk1: number): number {
  if (perpBid1 <= 0 || spotAsk1 <= 0) return 0;
  return perpBid1 / spotAsk1 - 1;
}

/**
 * 平仓可成交基差 = 合约卖一价 / 现货买一价 - 1
 * 用于判断退出时能否兑现基差
 */
export function calcExitExecutableBasis(perpAsk1: number, spotBid1: number): number {
  if (perpAsk1 <= 0 || spotBid1 <= 0) return 0;
  return perpAsk1 / spotBid1 - 1;
}

/**
 * 风控标记基差 = 合约 Mark Price / 现货中间价 - 1
 * 用于风控观察
 */
export function calcRiskMarkBasis(perpMarkPrice: number, spotMid: number): number {
  if (perpMarkPrice <= 0 || spotMid <= 0) return 0;
  return perpMarkPrice / spotMid - 1;
}

/**
 * 宽价差降级后的风控基差
 * 当现货价差 > 0.30% 时，使用现货买一价替代中间价
 */
export function calcRiskMarkBasisWideSpread(
  perpMarkPrice: number,
  spotBid1: number
): number {
  if (perpMarkPrice <= 0 || spotBid1 <= 0) return 0;
  return perpMarkPrice / spotBid1 - 1;
}

/**
 * 计算盘中价（mid price）
 */
export function calcMidPrice(bid1: number, ask1: number): number {
  if (bid1 <= 0 || ask1 <= 0) return 0;
  return (bid1 + ask1) / 2;
}

/**
 * 计算买卖价差率
 */
export function calcSpreadRate(bid1: number, ask1: number): number {
  const mid = calcMidPrice(bid1, ask1);
  if (mid <= 0) return 0;
  return (ask1 - bid1) / mid;
}
