import { NextResponse } from "next/server";
import { checkForAlerts, getActiveAlerts, acknowledgeAlert } from "@/lib/strategy-v121/opportunity/opportunityWatcher";

export async function GET() {
  const alerts = getActiveAlerts();
  return NextResponse.json({
    alerts,
    total: alerts.length,
    message: alerts.length === 0 ? "当前无合格机会告警" : undefined,
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  if (body.action === "refresh") {
    const newAlerts = checkForAlerts();
    return NextResponse.json({ alerts: newAlerts, total: newAlerts.length });
  }
  if (body.action === "ack" && body.alertId) {
    const ok = acknowledgeAlert(body.alertId);
    return NextResponse.json({ acknowledged: ok });
  }
  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
