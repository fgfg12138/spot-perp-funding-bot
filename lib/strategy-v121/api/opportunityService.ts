import type { ExchangeId, MarketSnapshot, OpportunityRecord } from "../domain/types";
import { evaluateHardFilters, type HardFilterInput, type HardFilterResult } from "../opportunity/hardFilters";
import { scoreOpportunity, type ScoringInput, type ScoringResult } from "../opportunity/scoring";
import { calcEntryExecutableBasis, calcRiskMarkBasis, calcMidPrice } from "../market/basis";

export interface OpportunityServiceInput {
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

export interface OpportunityServiceResult {
  record: OpportunityRecord;
  hardFilterResult: HardFilterResult;
  scoringResult: ScoringResult;
}

export function processOpportunity(input: OpportunityServiceInput): OpportunityServiceResult {
  const { path, spotSnapshot, perpSnapshot, funding8h, plannedNotional, isInCooldown, systemHealthy, listedHoursAgo, perpCanOpen } = input;

  const entryBasis = calcEntryExecutableBasis(perpSnapshot.bid1, spotSnapshot.ask1);
  const riskBasis = calcRiskMarkBasis(perpSnapshot.markPrice ?? 0, calcMidPrice(spotSnapshot.bid1, spotSnapshot.ask1));

  const hardFilterInput: HardFilterInput = {
    path, spotSnapshot, perpSnapshot, funding8h, plannedNotional,
    isInCooldown, systemHealthy, listedHoursAgo, perpCanOpen,
  };
  const hardFilterResult = evaluateHardFilters(hardFilterInput);

  const scoringInput: ScoringInput = {
    path: { spotExchange: path.spotExchange, perpExchange: path.perpExchange },
    spotSnapshot, perpSnapshot, funding8h, entryExecutableBasis: entryBasis,
  };
  const scoringResult = scoreOpportunity(scoringInput);

  const spotDepth = spotSnapshot.orderBook
    ? spotSnapshot.orderBook.asks.slice(0, 5).reduce((s, l) => s + l.price * l.qty, 0)
    : 0;
  const perpDepth = perpSnapshot.orderBook
    ? perpSnapshot.orderBook.bids.slice(0, 5).reduce((s, l) => s + l.price * l.qty, 0)
    : 0;

  const isCrossExchange = path.spotExchange !== path.perpExchange;
  const arbitragePath = { ...path, isCrossExchange };

  const record: OpportunityRecord = {
    id: `${path.spotExchange}:${path.perpExchange}:${path.symbol}`,
    path: arbitragePath, discoveredAtUtc: Date.now(), funding8h,
    entryExecutableBasis: entryBasis, riskMarkBasis: riskBasis,
    spotDepth, perpDepth, score: scoringResult.score, level: scoringResult.level,
    passed: hardFilterResult.passed, rejectReasons: hardFilterResult.rejectReasons,
    warnings: [...hardFilterResult.warnings, ...scoringResult.warnings],
    nextAction: hardFilterResult.nextAction,
  };

  return { record, hardFilterResult, scoringResult };
}
