"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [config, setConfig] = useState<any>(null);
  const [ks, setKs] = useState<any>(null);

  useEffect(() => {
    fetch("/api/v121/settings").then(r => r.json()).then(setConfig).catch(() => {});
    fetch("/api/v121/risk/kill-switch").then(r => r.json()).then(setKs).catch(() => {});
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">参数中心</h2>

      <div className="grid gap-6">
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-cyan-400">系统模式</h3>
          <div className="flex gap-2">
            {(["READ_ONLY", "PAPER", "SHADOW", "MAINNET_TINY", "CONTROLLED_LIVE"] as const).map((mode) => (
              <span key={mode} className={`px-3 py-1 rounded text-sm font-medium ${
                mode === config?.mode ? "bg-cyan-900 text-cyan-300" : "bg-gray-800 text-gray-500"
              }`}>
                {mode}
                {(mode === "MAINNET_TINY" || mode === "CONTROLLED_LIVE") && " 🔒"}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-2">MAINNET_TINY 和 CONTROLLED_LIVE 默认锁定，需环境变量开启</p>
        </section>

        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-red-400">Kill Switch</h3>
          <div className="text-sm">
            <span className="text-gray-400">当前状态: </span>
            <span className={ks?.killSwitch === "OFF" ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
              {ks ? ({ OFF: "关闭", READ_ONLY_ONLY: "仅只读", PAUSE_NEW_ENTRIES: "暂停新开仓", PAUSE_ALL_AUTOMATION: "暂停全部自动化" } as any)[ks.killSwitch] ?? ks.killSwitch : "—"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {(["OFF", "READ_ONLY_ONLY", "PAUSE_NEW_ENTRIES", "PAUSE_ALL_AUTOMATION"] as const).map(s => (
              <button key={s} onClick={async () => {
                await fetch("/api/v121/risk/kill-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: s }) });
                const r = await fetch("/api/v121/risk/kill-switch");
                setKs(await r.json());
              }} className={`px-2 py-1 text-xs border ${ks?.killSwitch === s ? "border-cyan-400 bg-cyan-900 text-cyan-200" : "border-gray-700 text-gray-400"}`}>
                {{ OFF: "关闭", READ_ONLY_ONLY: "仅只读", PAUSE_NEW_ENTRIES: "暂停新开仓", PAUSE_ALL_AUTOMATION: "暂停全部" }[s] ?? s}
              </button>
            ))}
          </div>
        </section>

        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-green-400">参数表</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <ParamRow label="最低 funding_8h" value="0.05%" />
            <ParamRow label="异常 funding_8h" value=">0.30%" />
            <ParamRow label="禁止开仓 funding" value=">0.50%" />
            <ParamRow label="现货最低成交额" value="$1M" />
            <ParamRow label="合约最低成交额" value="$5M" />
            <ParamRow label="现货最大价差" value="0.10%" />
            <ParamRow label="合约最大价差" value="0.08%" />
            <ParamRow label="宽价差降级" value=">0.30%" />
            <ParamRow label="批次比例" value="30/30/40" />
            <ParamRow label="偏差容忍" value="≤1%" />
            <ParamRow label="交易所" value={config?.enabledExchanges?.join(", ") ?? "—"} />
            <ParamRow label="仓位上限" value={`$${config?.plannedNotional?.toLocaleString() ?? "—"}`} />
          </div>
        </section>

        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-yellow-400">MAINNET_TINY 安全门</h3>
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-400">单笔上限</span><span>10 USDT</span></div>
            <div className="flex justify-between"><span className="text-gray-400">总暴露</span><span>50 USDT</span></div>
            <div className="flex justify-between"><span className="text-gray-400">杠杆</span><span>1x</span></div>
            <div className="flex justify-between"><span className="text-gray-400">HTX</span><span className="text-red-400">禁用</span></div>
            <div className="flex justify-between"><span className="text-gray-400">小币</span><span className="text-red-400">禁用</span></div>
            <div className="flex justify-between"><span className="text-gray-400">跨所</span><span className="text-red-400">禁用</span></div>
            <div className="flex justify-between"><span className="text-gray-400">自动开仓</span><span className="text-red-400">禁用</span></div>
            <div className="flex justify-between"><span className="text-gray-400">状态</span><span className="text-red-400 font-bold">🔒 锁定</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-gray-800 py-2">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-200 font-mono">{value}</span>
    </div>
  );
}
