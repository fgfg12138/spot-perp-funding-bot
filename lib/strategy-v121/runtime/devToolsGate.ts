import { NextResponse } from "next/server";
import { getRuntimeConfig } from "../config/runtimeConfig";

/**
 * Dev-tools gate for V121 engineering / diagnostic API routes.
 *
 * The product surface (app/(app)/**) only calls the kept APIs in the
 * G-area allowlist (order-plan, order-execution, auto-transfer, gate,
 * preflight, risk, settings, positions, close-preview, etc.). The
 * E/F-area engineering APIs (paper executions, rehearsal candidates,
 * dry-run intents, persistence status, shadow diagnostics, armed-dry-run,
 * single intent creation) are for operators running with
 * V121_ENABLE_DEV_TOOLS=1 — the same env switch that gates app/v121/** pages.
 *
 * Routes that are NOT product-facing should call this at the top of each
 * handler and return early when dev tools are disabled:
 *
 *   if (!isDevToolsEnabled()) return devToolsForbiddenResponse();
 *
 * This mirrors app/v121/layout.tsx's notFound() guard for pages. It does NOT
 * touch the real-order safety chain (V121_ENABLE_REAL_ORDER_EXECUTION,
 * guardedOrderExecutor, killSwitch) — those remain enforced regardless of
 * dev-tools state.
 */
export function isDevToolsEnabled(): boolean {
  return getRuntimeConfig().devToolsEnabled;
}

export function devToolsForbiddenResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      status: "not_found",
      message: "该内部诊断接口未开放。",
    },
    { status: 404 },
  );
}
