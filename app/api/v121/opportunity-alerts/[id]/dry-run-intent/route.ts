import { NextResponse } from "next/server";
import { createOrderIntent } from "@/lib/strategy-v121/execution/orderIntent";
import { getActiveAlerts } from "@/lib/strategy-v121/opportunity/opportunityWatcher";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const alerts = getActiveAlerts();
  const alert = alerts.find(a => a.id === id);
  if (!alert) return NextResponse.json({ error: "告警不存在或已过期" }, { status: 404 });

  const intent = createOrderIntent({
    symbol: alert.symbol,
    spotExchange: alert.spotExchange as any,
    perpExchange: alert.perpExchange as any,
    plannedNotionalUsdt: 10,
    batchNo: 1,
    reason: `从告警 ${id} 生成`,
  });

  return NextResponse.json({ ...intent, _realExecution: false, _message: "仅生成 dry-run intent，未实际下单" });
}
