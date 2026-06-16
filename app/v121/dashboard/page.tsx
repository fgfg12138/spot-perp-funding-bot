"use client";

import { useEffect, useState } from "react";

export default function DashboardPage() {
  const [health, setHealth] = useState<any>(null);
  const [worker, setWorker] = useState<any>(null);
  const [risk, setRisk] = useState<any>(null);
  const [opps, setOpps] = useState<any>(null);

  useEffect(() => {
    fetch("/api/v121/health").then(r => r.json()).then(setHealth).catch(() => {});
    fetch("/api/v121/worker").then(r => r.json()).then(setWorker).catch(() => {});
    fetch("/api/v121/risk").then(r => r.json()).then(setRisk).catch(() => {});
    fetch("/api/v121/opportunities").then(r => r.json()).then(setOpps).catch(() => {});
  }, []);

  if (!health) return <div className="text-gray-500 p-8">加载中...</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">生产控制台</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatusCard label="策略模式" value={health.modeLabel} color="cyan" />
        <StatusCard label="系统健康" value={health.health?.isHealthy ? "正常" : "异常"} color={health.health?.isHealthy ? "green" : "red"} />
        <StatusCard label="冻结状态" value={risk?.freezeLevel === "none" ? "无" : risk?.freezeLevel ?? "—"} color={risk?.freezeLevel === "none" ? "green" : "red"} />
        <StatusCard label="Worker 状态" value={worker?.state ?? "未启动"} color={worker?.state === "running" ? "green" : "yellow"} />
        <StatusCard label="Kill Switch" value={risk?.killSwitch === "OFF" ? "关闭" : risk?.killSwitch ?? "—"} color={risk?.killSwitch === "OFF" ? "green" : "red"} />
        <StatusCard label="Worker 周期" value={String(worker?.cycleCount ?? 0)} color="blue" />
        <StatusCard label="冻结执行数" value={String(risk?.frozenCount ?? 0)} color={risk?.frozenCount > 0 ? "red" : "green"} />
        <StatusCard label="偏差超限" value={String(risk?.deviationCount ?? 0)} color={risk?.deviationCount > 0 ? "yellow" : "green"} />
        <StatusCard label="数据源" value={opps?.dataSource === "real_market" ? "实时行情" : opps?.dataSource ?? "—"} color={opps?.dataSource === "real_market" ? "green" : "yellow"} />
        <StatusCard label="扫描时间" value={opps?.scannedAtUtc ? new Date(opps.scannedAtUtc).toLocaleTimeString("zh-CN") : "—"} color="blue" />
        <StatusCard label="机会总数" value={`${opps?.passedCount ?? 0}/${opps?.total ?? 0}`} color="cyan" />
      </div>
      <div className="mt-4 text-xs text-gray-600">
        数据源: API 实时 | 持久化: {risk?.canTrade ? "正常" : "受限"}
      </div>
    </div>
  );
}

function StatusCard({ label, value, color }: { label: string; value: string; color: string }) {
  const cm: Record<string, string> = {
    cyan: "text-cyan-400", green: "text-green-400", red: "text-red-400",
    blue: "text-blue-400", yellow: "text-yellow-400",
  };
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <div className="text-sm text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${cm[color] ?? "text-white"}`}>{value}</div>
    </div>
  );
}
