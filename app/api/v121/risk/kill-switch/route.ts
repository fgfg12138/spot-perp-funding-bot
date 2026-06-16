import { NextResponse } from "next/server";
import { getKillSwitch, setKillSwitch } from "@/lib/strategy-v121/risk/killSwitch";
import type { KillSwitchState } from "@/lib/strategy-v121/risk/killSwitch";

const VALID_STATES: KillSwitchState[] = ["OFF", "READ_ONLY_ONLY", "PAUSE_NEW_ENTRIES", "PAUSE_ALL_AUTOMATION"];

/**
 * GET /api/v121/risk/kill-switch — current state
 * POST /api/v121/risk/kill-switch — set state
 */
export async function GET() {
  return NextResponse.json({ killSwitch: getKillSwitch() });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效 JSON" }, { status: 400 });
  }

  const state = body.state as KillSwitchState;
  if (!VALID_STATES.includes(state)) {
    return NextResponse.json(
      { error: `无效状态: ${state}。可选: ${VALID_STATES.join(", ")}` },
      { status: 400 },
    );
  }

  setKillSwitch(state);
  return NextResponse.json({ killSwitch: state, updated: true });
}
