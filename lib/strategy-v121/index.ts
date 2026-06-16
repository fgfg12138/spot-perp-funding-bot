// ─── V1.2.1 主线统一导出 ──────────────────────────

export * from "./domain/types";
export * from "./domain/constants";
export * from "./domain/errors";

export * from "./market/basis";
export * from "./market/vwap";
export * from "./market/orderBook";
export * from "./market/symbolMap";
export * from "./market/contractSpec";
export * from "./market/fundingNormalize";
export * from "./market/dataFreshness";
export * from "./market/adapters/types";
export * from "./market/adapters/binancePublicAdapter";
export * from "./market/adapters/okxPublicAdapter";
export * from "./market/adapters/htxPublicAdapter";

export * from "./opportunity/hardFilters";
export * from "./opportunity/scoring";
export * from "./opportunity/cooldown";
export * from "./opportunity/scanner";

export * from "./profitability/netProfit";

export * from "./execution/batchPlan";
export * from "./execution/deviation";
export * from "./execution/shortLegRepair";
export * from "./execution/paperLifecycle";
export * from "./execution/paperStore";

export * from "./position/exitRules";
export * from "./position/monitor";

export * from "./risk/comboPnl";
export * from "./risk/riskArbiter";
export * from "./risk/killSwitch";

export * from "./health/freezeState";

export * from "./worker/runState";
export * from "./worker/heartbeat";
export * from "./worker/scheduler";
export * from "./worker/worker";

export * from "./time/utc";

export * from "./persistence/schema";
export * from "./persistence/repositories";
export * from "./persistence/repositoryTypes";
export * from "./persistence/fileSystemRepository";

export * from "./config/strategyConfig";
