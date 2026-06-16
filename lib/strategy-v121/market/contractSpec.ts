import type { ContractSpec } from "../domain/types";

/**
 * Known contract specifications.
 * Multipliers: how many base units per contract.
 * E.g., 1000PEPE has multiplier 1000 (1 contract = 1000 PEPE).
 */
const SPECS: Record<string, Partial<ContractSpec>> = {
  "BTC/USDT": { contractSize: 0.001, minQty: 0.001, tickSize: 0.1, maxLeverage: 125 },
  "ETH/USDT": { contractSize: 0.01, minQty: 0.01, tickSize: 0.01, maxLeverage: 100 },
  "SOL/USDT": { contractSize: 1, minQty: 0.1, tickSize: 0.001, maxLeverage: 75 },
  "DOGE/USDT": { contractSize: 1000, minQty: 1, tickSize: 0.00001, maxLeverage: 75 },
  "XRP/USDT": { contractSize: 10, minQty: 0.1, tickSize: 0.0001, maxLeverage: 75 },
  "ADA/USDT": { contractSize: 10, minQty: 0.1, tickSize: 0.00001, maxLeverage: 75 },
  "AVAX/USDT": { contractSize: 1, minQty: 0.01, tickSize: 0.001, maxLeverage: 75 },
  "DOT/USDT": { contractSize: 1, minQty: 0.01, tickSize: 0.001, maxLeverage: 75 },
  "LINK/USDT": { contractSize: 1, minQty: 0.01, tickSize: 0.001, maxLeverage: 75 },
  "MATIC/USDT": { contractSize: 10, minQty: 0.1, tickSize: 0.00001, maxLeverage: 75 },
  "1000PEPE/USDT": { contractSize: 1000, minQty: 1, tickSize: 0.0000001, maxLeverage: 50 },
  "1000BONK/USDT": { contractSize: 1000, minQty: 1, tickSize: 0.0000001, maxLeverage: 50 },
  "SUI/USDT": { contractSize: 1, minQty: 0.01, tickSize: 0.0001, maxLeverage: 50 },
  "ARB/USDT": { contractSize: 10, minQty: 0.1, tickSize: 0.00001, maxLeverage: 50 },
  "OP/USDT": { contractSize: 10, minQty: 0.1, tickSize: 0.00001, maxLeverage: 50 },
};

/**
 * Get contract spec for a given canonical symbol and exchange.
 * Returns a complete ContractSpec with defaults filled in.
 */
export function getContractSpec(
  canonical: string,
  exchange: string,
  exchangeSymbol: string
): ContractSpec {
  const base = SPECS[canonical] ?? {};
  return {
    symbol: exchangeSymbol,
    exchange: exchange as ContractSpec["exchange"],
    contractSize: base.contractSize ?? 1,
    minQty: base.minQty ?? 0.001,
    tickSize: base.tickSize ?? 0.01,
    maxLeverage: base.maxLeverage ?? 50,
    isOpen: true,
  };
}

/**
 * Check if a symbol is a "small coin" (1000x multiplier contracts).
 */
export function isSmallCoin(canonical: string): boolean {
  return canonical.startsWith("1000");
}
