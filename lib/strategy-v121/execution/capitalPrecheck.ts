import type { ExchangeId } from "../domain/types";
import { isApiKeyConfigured } from "../account/shadowAccountService";
import { getRuntimeConfig } from "../config/runtimeConfig";

// ─── 运行时配置（从 runtimeConfig 统一读取）────────────────────
const capitalCfg = getRuntimeConfig().capital;

const CFG = {
  /** 全局保留金比例 */
  GLOBAL_RESERVE_RATE: capitalCfg.globalReserveRate,
  /** 最小全局保留金额（USDT） */
  MIN_GLOBAL_RESERVE_USDT: capitalCfg.minGlobalReserveUsdt,
  /** 现货缓冲比例 */
  SPOT_BUFFER_RATE: capitalCfg.spotBufferRate,
  /** 永续缓冲比例 */
  PERP_BUFFER_RATE: capitalCfg.perpBufferRate,
  /** 允许自动划转（boolean fallback） */
  ALLOW_AUTO_TRANSFER: capitalCfg.allowAutoTransfer,
  /** 自动划转上限（USDT） */
  AUTO_TRANSFER_MAX_USDT: capitalCfg.autoTransferMaxUsdt,
} as const;

export interface CapitalPrecheckResult {
  exchange: ExchangeId;
  symbol: string;
  plannedNotionalUsdt: number;
  actualNotionalUsdt: number;
  totalFreeUsdt: number;
  spotFreeUsdt: number;
  perpFreeUsdt: number;
  globalReserveUsdt: number;
  usableCapitalUsdt: number;
  spotBufferRate: number;
  perpBufferRate: number;
  spotRequiredUsdt: number;
  perpRequiredUsdt: number;
  spotShortageUsdt: number;
  perpShortageUsdt: number;
  spotSurplusUsdt: number;
  perpSurplusUsdt: number;
  minRequiredNotionalUsdt: number;
  needsAutoTransfer: boolean;
  autoTransferAllowed: boolean;
  transferMode?: "disabled" | "suggest_only" | "auto_transfer";
  transferPlan?: {
    from: "spot" | "perp";
    to: "spot" | "perp";
    amountUsdt: number;
    reason: string;
  };
  passBeforeTransfer: boolean;
  passAfterTransfer?: boolean;
  blockReason?: string;
  realExecutionAllowed: false;
  chineseMessage: string;
}

async function readSpotBalance(exchange: ExchangeId): Promise<number | null> {
  try {
    const { createAccountAdapter } = await import("../account/adapters/accountAdapterFactory");
    const { adapter } = createAccountAdapter(exchange);
    const balances = await adapter.fetchBalances();
    const usdt = balances.find(b => b.asset === "USDT");
    return usdt ? usdt.free : 0;
  } catch { return null; }
}

async function readFuturesBalance(exchange: ExchangeId): Promise<number | null> {
  try {
    if (exchange === "binance") {
      const { binanceSign, utcTimestampMs } = await import("../account/adapters/accountSigning");
      const query = `timestamp=${utcTimestampMs()}&recvWindow=5000`;
      const { signature, apiKey } = binanceSign(query);
      const res = await fetch(`https://fapi.binance.com/fapi/v2/account?${query}&signature=${signature}`, {
        headers: { "X-MBX-APIKEY": apiKey },
      });
      const data = await res.json();
      return Number(data.availableBalance ?? data.totalWalletBalance ?? 0);
    }
    if (exchange === "okx") {
      const { okxSign } = await import("../account/adapters/accountSigning");
      const ts = new Date().toISOString();
      const { apiKey, passphrase, sign } = okxSign(ts, "GET", "/api/v5/account/balance", "");
      const res = await fetch("https://www.okx.com/api/v5/account/balance", {
        headers: { "OK-ACCESS-KEY": apiKey, "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": passphrase, "Content-Type": "application/json" },
      });
      const body = await res.json();
      if (body.code !== "0") return null;
      const details = body.data?.[0]?.details ?? [];
      const usdt = details.find((d: any) => d.ccy === "USDT");
      return usdt ? Number(usdt.cashBal ?? usdt.availBal ?? 0) : 0;
    }
    return null;
  } catch { return null; }
}

export async function runCapitalPrecheck(
  exchange: ExchangeId, symbol: string, plannedNotionalUsdt: number,
): Promise<CapitalPrecheckResult> {
  const noAccess = (reason: string): CapitalPrecheckResult => ({
    exchange, symbol, plannedNotionalUsdt, actualNotionalUsdt: 0,
    totalFreeUsdt: 0, spotFreeUsdt: 0, perpFreeUsdt: 0,
    globalReserveUsdt: 0, usableCapitalUsdt: 0,
    spotBufferRate: 0, perpBufferRate: 0,
    spotRequiredUsdt: 0, perpRequiredUsdt: 0,
    spotShortageUsdt: 0, perpShortageUsdt: 0,
    spotSurplusUsdt: 0, perpSurplusUsdt: 0,
    minRequiredNotionalUsdt: 10,
    needsAutoTransfer: false, autoTransferAllowed: false,
    passBeforeTransfer: false,
    blockReason: reason, realExecutionAllowed: false,
    chineseMessage: `资金预检失败: ${reason}`,
  });

  if (!isApiKeyConfigured(exchange)) return noAccess(`${exchange} API Key 未配置`);

  const spotFree = await readSpotBalance(exchange);
  if (spotFree === null) return noAccess("无法读取现货账户余额");

  const perpFree = await readFuturesBalance(exchange);
  if (perpFree === null) return noAccess("无法读取合约账户可用保证金，禁止进入真实执行");

  const totalFree = spotFree + perpFree;

  // 全局冗余
  const globalReserve = Math.max(CFG.MIN_GLOBAL_RESERVE_USDT, totalFree * CFG.GLOBAL_RESERVE_RATE);
  const usableCapital = Math.max(0, totalFree - globalReserve);

  // 缓冲
  const spotBufferRate = CFG.SPOT_BUFFER_RATE;
  const perpBufferRate = CFG.PERP_BUFFER_RATE;

  // actualNotional = min(planned, usableCapital / (2 + buffers))
  const divisor = 2 + spotBufferRate + perpBufferRate;
  const safeMaxNotional = usableCapital / divisor;
  const actualNotional = Math.min(plannedNotionalUsdt, safeMaxNotional);

  const minRequired = 10;
  if (actualNotional < minRequired) {
    return noAccess(`扣除冗余后可下单金额 ${actualNotional.toFixed(2)}U < 最小 ${minRequired}U，放弃机会`);
  }

  // 两边需求
  const spotRequired = actualNotional * (1 + spotBufferRate);
  const perpRequired = actualNotional * (1 + perpBufferRate);

  const spotShortage = Math.max(0, spotRequired - spotFree);
  const perpShortage = Math.max(0, perpRequired - perpFree);
  const spotSurplus = Math.max(0, spotFree - spotRequired);
  const perpSurplus = Math.max(0, perpFree - perpRequired);

  // 加载用户设置获取划转模式
  let allowTransfer = false;
  let transferMax = 50;
  let transferMode: "disabled" | "suggest_only" | "auto_transfer" = "disabled";
  try {
    const { loadSettings } = await import("../settings/userStrategySettingsStore");
    const us = await loadSettings();
    transferMode = us.transfer.mode;
    transferMax = us.transfer.maxAutoTransferUsdt;
    allowTransfer = us.transfer.allowAutoTransfer && transferMode !== "disabled";
  } catch {
    allowTransfer = CFG.ALLOW_AUTO_TRANSFER;
    transferMax = CFG.AUTO_TRANSFER_MAX_USDT;
  }

  let transferPlan: CapitalPrecheckResult["transferPlan"] | undefined;
  let needsTransfer = false;
  let transferOk = false;

  if (perpShortage > 0 && spotSurplus >= perpShortage) {
    const amount = Math.min(perpShortage, transferMax);
    needsTransfer = true;
    if (allowTransfer && amount <= transferMax) {
      transferPlan = { from: "spot", to: "perp", amountUsdt: Math.round(amount * 100) / 100, reason: `合约侧缺 ${perpShortage.toFixed(2)}U，现货侧盈余 ${spotSurplus.toFixed(2)}U` };
      transferOk = true;
    } else {
      transferPlan = { from: "spot", to: "perp", amountUsdt: Math.round(amount * 100) / 100, reason: `需要划转 ${amount.toFixed(2)}U 但超过上限 ${transferMax}U 或自动划转未开启` };
    }
  } else if (spotShortage > 0 && perpSurplus >= spotShortage) {
    const amount = Math.min(spotShortage, transferMax);
    needsTransfer = true;
    if (allowTransfer && amount <= transferMax) {
      transferPlan = { from: "perp", to: "spot", amountUsdt: Math.round(amount * 100) / 100, reason: `现货侧缺 ${spotShortage.toFixed(2)}U，合约侧盈余 ${perpSurplus.toFixed(2)}U` };
      transferOk = true;
    } else {
      transferPlan = { from: "perp", to: "spot", amountUsdt: Math.round(amount * 100) / 100, reason: `需要划转 ${amount.toFixed(2)}U 但超过上限 ${transferMax}U 或自动划转未开启` };
    }
  }

  const passBefore = spotShortage === 0 && perpShortage === 0;
  const passAfter = transferOk;

  let blockReason: string | undefined;
  let chineseMessage: string;
  if (passBefore) {
    chineseMessage = `资金预检通过: 现货 ${spotFree.toFixed(2)}U，合约 ${perpFree.toFixed(2)}U，实际执行 ${actualNotional.toFixed(2)}U`;
  } else if (needsTransfer && transferOk) {
    chineseMessage = `需要内部划转 ${transferPlan!.amountUsdt.toFixed(2)}U (${transferPlan!.from}→${transferPlan!.to})，划转后重新审计`;
    blockReason = `需要自动内部划转，划转完成并重新审计前不能下单`;
  } else if (needsTransfer) {
    chineseMessage = `资金不足且无法自动划转: ${transferPlan?.reason ?? ""}`;
    blockReason = transferPlan?.reason ?? "资金不足";
  } else {
    const reasons: string[] = [];
    if (spotShortage > 0) reasons.push(`现货缺 ${spotShortage.toFixed(2)}U`);
    if (perpShortage > 0) reasons.push(`合约缺 ${perpShortage.toFixed(2)}U`);
    chineseMessage = `资金不足: ${reasons.join("，")}`;
    blockReason = chineseMessage;
  }

  return {
    exchange, symbol, plannedNotionalUsdt, actualNotionalUsdt: actualNotional,
    totalFreeUsdt: totalFree, spotFreeUsdt: spotFree, perpFreeUsdt: perpFree,
    globalReserveUsdt: globalReserve, usableCapitalUsdt: usableCapital,
    spotBufferRate, perpBufferRate,
    spotRequiredUsdt: spotRequired, perpRequiredUsdt: perpRequired,
    spotShortageUsdt: spotShortage, perpShortageUsdt: perpShortage,
    spotSurplusUsdt: spotSurplus, perpSurplusUsdt: perpSurplus,
    minRequiredNotionalUsdt: minRequired,
    needsAutoTransfer: needsTransfer, transferMode,
    autoTransferAllowed: transferOk,
    transferPlan,
    passBeforeTransfer: passBefore, passAfterTransfer: passAfter,
    blockReason, realExecutionAllowed: false,
    chineseMessage,
  };
}
