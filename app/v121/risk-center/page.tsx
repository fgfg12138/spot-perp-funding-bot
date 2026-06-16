"use client";

import { useEffect, useState } from "react";

export default function RiskCenterPage() {
  const [data, setData] = useState<any>(null);

  const fetchData = () => {
    fetch("/api/v121/risk").then(r => r.json()).then(setData).catch(() => {});
  };

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, []);

  const setKS = async (state: string) => {
    await fetch("/api/v121/risk/kill-switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    fetchData();
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">风控中心</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <RiskCard label="Kill Switch" value={data?.killSwitch === "OFF" ? "关闭" : data?.killSwitch ?? "—"} color={data?.killSwitch === "OFF" ? "green" : "red"} />
        <RiskCard label="冻结状态" value={data?.freezeLevel === "none" ? "无" : data?.freezeLevel ?? "—"} color={data?.freezeLevel === "none" ? "green" : "red"} />
        <RiskCard label="可交易" value={data?.canTrade ? "是" : "否"} color={data?.canTrade ? "green" : "red"} />
        <RiskCard label="执行中" value={String(data?.openExecutionCount ?? 0)} color="blue" />
        <RiskCard label="冻结数" value={String(data?.frozenCount ?? 0)} color={data?.frozenCount > 0 ? "red" : "green"} />
        <RiskCard label="偏差超限" value={String(data?.deviationCount ?? 0)} color={data?.deviationCount > 0 ? "yellow" : "green"} />
        <RiskCard label="允许操作" value={(data?.allowedActions ?? []).join(", ") || "无"} color="green" />
        <RiskCard label="禁止操作" value={(data?.prohibitedActions ?? []).join(", ") || "无"} color="red" />
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-red-400">Kill Switch 控制</h3>
        <div className="flex flex-wrap gap-2">
          {(["OFF", "READ_ONLY_ONLY", "PAUSE_NEW_ENTRIES", "PAUSE_ALL_AUTOMATION"] as const).map(s => (
            <button key={s}
              onClick={() => setKS(s)}
              className={`px-3 py-1 text-xs border ${data?.killSwitch === s ? "border-cyan-400 bg-cyan-900 text-cyan-200" : "border-gray-700 text-gray-400 hover:border-gray-500"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-600 mt-2">
          ⚠️ PAUSE_ALL_AUTOMATION 阻断所有自动化操作。切换需谨慎。
        </p>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-3 text-yellow-400">偏差告警</h3>
        {!data?.deviations?.length ? (
          <p className="text-sm text-gray-500">无偏差告警</p>
        ) : (
          data.deviations.map((d: any) => (
            <div key={d.id} className="text-sm text-red-400">执行 {d.id}: 偏差 {(d.deviation * 100).toFixed(2)}%</div>
          ))
        )}
      </div>
    </div>
  );
}

function RiskCard({ label, value, color }: { label: string; value: string; color: string }) {
  const c = color === "green" ? "text-green-400" : color === "red" ? "text-red-400" : color === "yellow" ? "text-yellow-400" : "text-blue-400";
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <div className="text-sm text-gray-400">{label}</div>
      <div className={`text-xl font-bold ${c}`}>{value}</div>
    </div>
  );
}
