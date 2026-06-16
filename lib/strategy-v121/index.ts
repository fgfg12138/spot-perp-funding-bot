// ─── V1.2.1 主线统一导出 ──────────────────────────
// 所有核心模块通过此入口对外暴露

export * from "./domain/types";
export * from "./domain/constants";
export * from "./domain/errors";

export * from "./market/basis";
export * from "./market/vwap";
export * from "./market/orderBook";
export * from "./market/symbolMap";
export * from "./market/contractSpec";
export * from "./market/fundingNormalize";
export * from "./market/adapters/types";
export * from "./market/adapters/binancePublicAdapter";
export * from "./market/adapters/okxPublicAdapter";
export * from "./market/adapters/htxPublicAdapter";

export * from "./opportunity/hardFilters";
export * from "./opportunity/scoring";
export * from "./opportunity/cooldown";

export * from "./profitability/netProfit";

export * from "./execution/batchPlan";
export * from "./execution/deviation";
export * from "./execution/shortLegRepair";

export * from "./position/exitRules";

export * from "./risk/comboPnl";
export * from "./risk/riskArbiter";

export * from "./health/freezeState";

export * from "./time/utc";

export * from "./persistence/schema";
export * from "./persistence/repositories";

export * from "./config/strategyConfig";
