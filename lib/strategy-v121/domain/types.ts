// ─── 交易所与市场类型 ────────────────────────────────

export type ExchangeId = "binance" | "okx" | "htx";

export type MarketType = "spot" | "perp";

export type StrategyMode = "READ_ONLY" | "PAPER" | "SHADOW" | "MAINNET_TINY" | "CONTROLLED_LIVE";

export type PositionSide = "spot_long" | "perp_short";

export type CandidateLevel = "S" | "A" | "B" | "C";

// ─── 交易对 ──────────────────────────────────────────

export interface Symbol {
  base: string;
  quote: string;
  exchange: ExchangeId;
  marketType: MarketType;
  rawSymbol: string;
}

export interface NormalizedSymbol {
  base: string;
  quote: string;
  unifiedSymbol: string; // e.g. "BTC/USDT"
}

// ─── 套利路径 ────────────────────────────────────────

export interface ArbitragePath {
  symbol: string;           // unified "BTC/USDT"
  spotExchange: ExchangeId;
  perpExchange: ExchangeId;
  isCrossExchange: boolean; // spot !== perp
}

// ─── 盘口数据 ────────────────────────────────────────

export interface OrderBookLevel {
  price: number;
  qty: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestampUtc: number;
}

// ─── 行情快照 ────────────────────────────────────────

export interface MarketSnapshot {
  exchangeId: ExchangeId;
  symbol: string;
  marketType: MarketType;

  bid1: number;
  ask1: number;
  mid: number;

  markPrice?: number;     // perp only
  indexPrice?: number;    // perp only

  fundingRate?: number;
  fundingIntervalHours?: number;
  nextFundingTimeUtc?: number;

  volume24hUsdt?: number;
  orderBook?: OrderBook;
  spreadRate: number;     // (ask1 - bid1) / mid

  timestampUtc: number;
  exchangeTimestamp?: number;
  localReceiveTimeUtc?: number;
  latencyMs?: number;
  tradingStatus: "trading" | "halt" | "closed";

  contractSpec?: ContractSpec; // perp only
}

// ─── 合约规格 ────────────────────────────────────────

export interface ContractSpec {
  symbol: string;
  exchange: ExchangeId;
  contractSize: number;       // e.g. 0.001 BTC, 1 USDT
  minQty: number;
  tickSize: number;
  maxLeverage: number;
  isOpen: boolean;
}

// ─── VWAP 结果 ───────────────────────────────────────

export interface VwapResult {
  avgPrice: number;
  filledQty: number;
  filledNotional: number;
  slippageRate: number;     // (avgPrice - mid) / mid, percentage
  isFullyFillable: boolean;
}

// ─── 资金费信息 ──────────────────────────────────────

export interface FundingInfo {
  exchange: ExchangeId;
  symbol: string;
  fundingRate: number;
  fundingIntervalHours: number;
  nextFundingTimeUtc: number;
  funding8h: number;        // normalized to 8h
}

// ─── 系统健康 ────────────────────────────────────────

export interface HealthStatus {
  timeSyncMs: number;
  wsLatencyMs: number;
  restOk: boolean;
  wsOk: boolean;
  dataFreshnessMs: number;
  isHealthy: boolean;
}

export type FreezeLevel = "none" | "level1" | "level2";

export interface FreezeState {
  level: FreezeLevel;
  triggeredAtUtc: number;
  reason: string;
  allowedActions: string[];
  prohibitedActions: string[];
}

// ─── 机会记录 ────────────────────────────────────────

export interface OpportunityRecord {
  id: string;
  path: ArbitragePath;
  discoveredAtUtc: number;
  funding8h: number;
  entryExecutableBasis: number;   // perp bid1 / spot ask1 - 1
  riskMarkBasis: number;          // perp mark / spot mid - 1
  spotDepth: number;
  perpDepth: number;
  score: number;
  level: CandidateLevel;
  passed: boolean;
  rejectReasons: RejectReason[];
  warnings: string[];
  nextAction: string;
}

export interface RejectReason {
  rule: string;
  detail: string;
}

// ─── 评分 ────────────────────────────────────────────

export interface ScoreBreakdown {
  availability: number;   // 10
  funding: number;        // 20
  basis: number;          // 20
  spotLiquidity: number;  // 15
  perpLiquidity: number;  // 15
  stability: number;      // 10
  riskStatus: number;     // 10
  total: number;
}

// ─── 收益 ────────────────────────────────────────────

export interface NetProfitBreakdown {
  entryBasis: number;
  expectedExitBasis: number;
  expectedFunding: number;
  fees: number;
  slippage: number;
  riskDiscount: number;
  expectedNetRate: number;      // percentage
  expectedNetProfit: number;    // USDT
  passedThreshold: boolean;
}

// ─── 执行 ────────────────────────────────────────────

export interface BatchExecutionPlan {
  totalNotional: number;
  batches: BatchPlanItem[];
}

export interface BatchPlanItem {
  batchNo: number;          // 1, 2, 3
  ratio: number;            // 0.3, 0.3, 0.4
  cumulativeTarget: number; // 0.3, 0.6, 1.0
  targetNotional: number;
}

export type BatchState = "pending" | "executing" | "partial" | "filled" | "failed" | "repaired";

export interface BatchExecutionState {
  plan: BatchExecutionPlan;
  currentBatch: number;
  spotFilledQty: number;
  perpFilledQty: number;
  spotAvgPrice: number;
  perpAvgPrice: number;
  actualBasis: number;
  positionDeviation: number;    // percentage
  state: BatchState;
  shortLegAction?: ShortLegAction;
}

// ─── 订单 ────────────────────────────────────────────

export type OrderStatus = "pending" | "filled" | "partial" | "cancelled" | "unknown";

export interface PaperOrder {
  id: string;
  batchNo: number;
  leg: "spot" | "perp";
  side: "buy" | "sell";
  price: number;
  qty: number;
  status: OrderStatus;
  filledQty: number;
  avgPrice?: number;
  submittedAtUtc: number;
  timeoutSeconds: number;
}

export interface PaperFill {
  orderId: string;
  price: number;
  qty: number;
  timestampUtc: number;
}

// ─── 短腿修复 ────────────────────────────────────────

export type ShortLegAction = "repair_perp" | "repair_spot" | "exit_spot" | "exit_perp" | "freeze";

// ─── 持仓 ────────────────────────────────────────────

export interface PositionSnapshot {
  positionId: string;
  path: ArbitragePath;
  timestampUtc: number;

  currentBasis: number;         // current exit executable basis
  markPrice: number;
  funding8h: number;
  realizedFunding: number;

  spotQty: number;
  spotAvgPrice: number;
  perpQty: number;
  perpAvgPrice: number;

  positionDeviation: number;    // percentage
  marginRatio?: number;
  adlLevel?: ADLLevel;

  spotDepth: number;
  perpDepth: number;

  healthState: HealthStatus;
  riskReason?: string;
}

// ─── 风控 ────────────────────────────────────────────

export type ADLLevel = "low" | "medium" | "medium_high" | "high";

export interface RiskDecision {
  action: "none" | "reduce" | "repair" | "exit" | "freeze" | "emergency";
  priority: number;             // 1=highest
  reason: RiskReason;
  detail: string;
}

export interface RiskReason {
  type: "stop_loss" | "drawdown" | "deviation" | "adl" | "liquidity" | "margin" | "freeze" | "time_stop";
  severity: "info" | "warning" | "critical";
}

// ─── 复盘 ────────────────────────────────────────────

export interface ReviewRecord {
  positionId: string;
  netProfit: number;
  basisProfit: number;
  fundingProfit: number;
  totalCost: number;
  maxDrawdown: number;
  profitDeviation: number;      // actual - expected
  fundingRealizationRate: number;
  basisRealizationRate: number;
  slippageRatio: number;
  theoreticalApy: number;
  actualApy: number;
  deviationReason?: string;
  nextOptimization?: string;
}
