import { NextResponse } from "next/server";
import { runDiagnostics } from "@/lib/strategy-v121/account/shadowDiagnostics";

/** GET /api/v121/shadow/diagnostics — 私有账户只读诊断 */
export async function GET() {
  const results = await runDiagnostics();
  const json = JSON.stringify(results);

  const secretCheck = (
    !json.includes("BINANCE_API_KEY") &&
    !json.includes("BINANCE_API_SECRET") &&
    !json.includes("OKX_API_KEY") &&
    !json.includes("OKX_API_SECRET") &&
    !json.includes("OKX_PASSPHRASE") &&
    !json.includes("HTX_API_KEY") &&
    !json.includes("HTX_API_SECRET") &&
    !json.includes("Signature") &&
    !json.includes("X-MBX-APIKEY")
  );

  return NextResponse.json({
    diagnostics: results,
    secretExposureCheck: secretCheck ? "passed" : "failed",
    generatedAtUtc: new Date().toISOString(),
  });
}
