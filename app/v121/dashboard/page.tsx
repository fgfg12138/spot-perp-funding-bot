import { getDashboardStatus } from "@/lib/strategy-v121/api/dashboardService";

export default function DashboardPage() {
  const status = getDashboardStatus("READ_ONLY");

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">生产控制台</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatusCard label="策略模式" value={status.mode} color="cyan" />
        <StatusCard label="系统健康" value={status.health.isHealthy ? "正常" : "异常"} color={status.health.isHealthy ? "green" : "red"} />
        <StatusCard label="冻结状态" value={status.freeze.level === "none" ? "无" : status.freeze.level} color={status.freeze.level === "none" ? "green" : "red"} />
        <StatusCard label="今日机会" value={String(status.opportunityCount)} color="blue" />
        <StatusCard label="当前持仓" value={String(status.openPositionCount)} color="yellow" />
        <StatusCard label="今日 PnL" value={`$${status.todayPnl.toFixed(2)}`} color={status.todayPnl >= 0 ? "green" : "red"} />
        <StatusCard label="时间同步" value={`${status.health.timeSyncMs}ms`} color={status.health.timeSyncMs < 500 ? "green" : "red"} />
        <StatusCard label="WS 延迟" value={`${status.health.wsLatencyMs}ms`} color={status.health.wsLatencyMs < 3000 ? "green" : "red"} />
      </div>
    </div>
  );
}

function StatusCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    cyan: "text-cyan-400", green: "text-green-400", red: "text-red-400",
    blue: "text-blue-400", yellow: "text-yellow-400",
  };
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <div className="text-sm text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${colorMap[color] ?? "text-white"}`}>{value}</div>
    </div>
  );
}
