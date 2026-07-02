import type { AccountBalanceSnapshot, AccountPositionSnapshot } from "../account/accountTypes";
import type { ExchangeId } from "../domain/types";
import { isRealCloseExecutionEnabled } from "../config/runtimeConfig";

/** 将 BTC/USDT 格式化为交易所原生格式。 */
export function formatRawSymbolForExchange(symbol: string, exchange: ExchangeId): string {
  if (exchange === "binance") return symbol.replace("/", "");
  if (exchange === "okx") return symbol.replace("/", "-");
  return symbol;
}

/** 判断开仓执行结果是否应视为成功。 */
export function isEntryResultSuccessful(status: string): boolean {
  return status === "filled" || status === "dry_run";
}

/** 从余额数组中提取对应 base asset 的现货余额。 */
export function extractSpotBalance(balances: AccountBalanceSnapshot[], baseAsset: string): AccountBalanceSnapshot | null {
  return balances.find((b) => b.asset === baseAsset) ?? null;
}

/** 从持仓数组中提取对应 symbol 的 perp_short 仓位。 */
export function extractPerpShortPosition(positions: AccountPositionSnapshot[], symbol: string): AccountPositionSnapshot | null {
  return positions.find(
    (p) => p.symbol === symbol && p.side === "perp_short",
  ) ?? null;
}

/** 根据运行模式判断真实平仓是否启用（替代 direct process.env 访问）。 */
export function isRealCloseEnabled(mode: string, _env?: Record<string, string | undefined>): boolean {
  return mode !== "SHADOW" && isRealCloseExecutionEnabled();
}
