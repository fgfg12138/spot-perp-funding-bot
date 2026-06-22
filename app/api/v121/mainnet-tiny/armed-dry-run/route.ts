import { NextResponse } from "next/server";
import { isDevToolsEnabled, devToolsForbiddenResponse } from "@/lib/strategy-v121/runtime/devToolsGate";
import { checkMainnetTinyGate } from "@/lib/strategy-v121/mainnetTiny/mainnetTinyGate";
import { runMainnetTinyPreflight } from "@/lib/strategy-v121/mainnetTiny/mainnetTinyPreflight";
import { getPersistenceMode } from "@/lib/strategy-v121/persistence/persistenceMode";
import { getRepository } from "@/lib/strategy-v121/persistence/repositoryFactory";

/** GET /api/v121/mainnet-tiny/armed-dry-run */
export async function GET() {
  if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
  const gate = checkMainnetTinyGate();
  const preflight = runMainnetTinyPreflight();
  const repo = getRepository();
  const scan = repo.latest("latest_scan");
  const hb = repo.latest("worker_heartbeats");
  const scanTs = Number((scan as any)?.scannedAtUtc ?? (scan as any)?.scanned_at_utc ?? 0);
  const hbTs = Number((hb as any)?.lastCycleAtUtc ?? (hb as any)?.last_cycle_at_utc ?? 0);

  return NextResponse.json({
    mode: process.env.V121_MODE ?? "READ_ONLY",
    dryRun: process.env.V121_MAINNET_TINY_DRY_RUN === "true",
    realOrderExecutionEnabled: process.env.V121_REAL_ORDER_EXECUTION_ENABLED === "true",
    gateAllowed: gate.allowed,
    preflightScore: preflight.readinessScore,
    persistenceMode: getPersistenceMode(),
    latestScanAge: scanTs > 0 ? `${Math.round((Date.now() - scanTs) / 1000)}秒前` : "无",
    workerHeartbeatAge: hbTs > 0 ? `${Math.round((Date.now() - hbTs) / 1000)}秒前` : "无",
    canCreateIntent: true,
    canPlaceRealOrder: false,
    chineseMessage: "MAINNET_TINY 预演模式：配置门可能满足，但真实下单总开关仍关闭。",
  });
}
