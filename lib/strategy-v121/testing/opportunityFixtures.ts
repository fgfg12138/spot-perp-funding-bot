import type { OpportunityRecord, ArbitragePath } from "../domain/types";

export function makePassedOpportunity(overrides?: Partial<OpportunityRecord>): OpportunityRecord {
  const path: ArbitragePath = { symbol: "BTC/USDT", spotExchange: "binance", perpExchange: "binance", isCrossExchange: false };
  return {
    id: `test-opp-${Date.now()}`,
    path, discoveredAtUtc: Date.now(),
    funding8h: 0.0006, entryExecutableBasis: 0.005, riskMarkBasis: 0.004,
    spotDepth: 50000, perpDepth: 80000,
    score: 88, level: "S", passed: true,
    rejectReasons: [], warnings: [], nextAction: "enter",
    ...overrides,
  } as OpportunityRecord;
}

export function makeRejectedOpportunity(reason: string = "funding_too_low"): OpportunityRecord {
  return makePassedOpportunity({
    id: `test-rej-${Date.now()}`,
    passed: false, level: "C", score: 30,
    rejectReasons: [{ rule: reason, detail: "测试淘汰" }],
  } as any);
}
