"use client";

import { useEffect, useState } from "react";

const DEFAULT_SETTINGS = {
  version: 1,
  funding: { minFundingRate8h: 0.0005, minNetProfitRate: 0, minSecondsToFunding: 300 },
  notional: { plannedNotionalUsdt: 10, maxOrderNotionalUsdt: 50, maxSymbolExposureUsdt: 50, maxExchangeExposureUsdt: 100, allowAutoDownsize: true },
  capital: { globalReserveRate: 0.2, minGlobalReserveUsdt: 10, spotBufferRate: 0.015, perpBufferRate: 0.035 },
  transfer: { allowAutoTransfer: false, mode: "disabled" as const, maxAutoTransferUsdt: 50, allowSpotToPerp: true, allowPerpToSpot: true, requireReauditAfterTransfer: true },
  universe: { useDynamicUniverse: true, maxDynamicSymbolsPerExchange: 50, minSpotVolume24hUsdt: 0, minPerpVolume24hUsdt: 0, allowSmallCaps: false, symbolWhitelist: [] as string[], symbolBlacklist: [] as string[], prioritySymbols: [] as string[] },
  execution: { requireHumanApproval: true, allowRealOrders: false, maxLegDeviationRate: 0.01, orderTimeoutMs: 15000, freezeOnUnknownOrder: true, freezeOnUnknownTransfer: true },
};

export default function SettingsPage() {
  const [s, setS] = useState<any>(null);
  const [ks, setKs] = useState<any>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/v121/settings").then(r => r.json()).then(setS).catch(() => {});
    fetch("/api/v121/risk/kill-switch").then(r => r.json()).then(setKs).catch(() => {});
  }, []);

  const patch = (path: string, val: any) => {
    setS((prev: any) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      const parts = path.split(".");
      let cur = copy;
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
      cur[parts[parts.length - 1]] = val;
      return copy;
    });
  };

  const save = async () => {
    try {
      const r = await fetch("/api/v121/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      if (r.ok) { setMsg("保存成功"); setTimeout(() => setMsg(""), 2000); }
      else { const d = await r.json(); setMsg(`保存失败: ${d.error ?? d}`); }
    } catch (e: any) { setMsg(`保存失败: ${e.message}`); }
  };

  const restore = async () => {
    setS(DEFAULT_SETTINGS);
    try {
      const r = await fetch("/api/v121/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(DEFAULT_SETTINGS) });
      if (r.ok) setMsg("已恢复默认值");
    } catch (e: any) { setMsg(`恢复失败: ${e.message}`); }
  };

  if (!s) return <div className="text-gray-500 p-4">加载中...</div>;

  const txMode = s.transfer?.mode ?? "disabled";
  const txAllowed = s.transfer?.allowAutoTransfer ?? false;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">参数中心</h2>

      {msg && <div className="bg-green-900/30 border border-green-700/40 text-green-200 px-3 py-2 rounded mb-4 text-sm">{msg}</div>}

      <div className="grid gap-6">
        {/* 系统模式 */}
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-cyan-400">系统模式</h3>
          <div className="flex gap-2 flex-wrap">
            {(["READ_ONLY", "PAPER", "SHADOW", "MAINNET_TINY", "CONTROLLED_LIVE"] as const).map((mode) => (
              <span key={mode} className={`px-3 py-1 rounded text-sm font-medium ${
                mode === s?.mode ? "bg-cyan-900 text-cyan-300" : "bg-gray-800 text-gray-500"
              }`}>
                {mode}
                {(mode === "MAINNET_TINY" || mode === "CONTROLLED_LIVE") && " 🔒"}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-2">MAINNET_TINY 和 CONTROLLED_LIVE 需环境变量开启</p>
        </section>

        {/* Kill Switch */}
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-red-400">Kill Switch</h3>
          <div className="text-sm">
            <span className="text-gray-400">当前状态: </span>
            <span className={ks?.killSwitch === "OFF" ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
              {ks ? ({ OFF: "关闭", READ_ONLY_ONLY: "仅只读", PAUSE_NEW_ENTRIES: "暂停新开仓", PAUSE_ALL_AUTOMATION: "暂停全部自动化" } as any)[ks.killSwitch] ?? ks.killSwitch : "—"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {(["OFF", "READ_ONLY_ONLY", "PAUSE_NEW_ENTRIES", "PAUSE_ALL_AUTOMATION"] as const).map(sw => (
              <button key={sw} onClick={async () => {
                await fetch("/api/v121/risk/kill-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: sw }) });
                const r = await fetch("/api/v121/risk/kill-switch");
                setKs(await r.json());
              }} className={`px-2 py-1 text-xs border ${ks?.killSwitch === sw ? "border-cyan-400 bg-cyan-900 text-cyan-200" : "border-gray-700 text-gray-400"}`}>
                {{ OFF: "关闭", READ_ONLY_ONLY: "仅只读", PAUSE_NEW_ENTRIES: "暂停新开仓", PAUSE_ALL_AUTOMATION: "暂停全部" }[sw] ?? sw}
              </button>
            ))}
          </div>
        </section>

        {/* 资金费门槛 */}
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-green-400">资金费与成交额</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <ParamEdit label="最低 funding_8h" val={s.funding?.minFundingRate8h} onChange={v => patch("funding.minFundingRate8h", v)} fmt={v => `${(v * 100).toFixed(3)}%`} />
            <ParamEdit label="最低净收益率" val={s.funding?.minNetProfitRate ?? 0} onChange={v => patch("funding.minNetProfitRate", v)} fmt={v => `${(v * 100).toFixed(2)}%`} />
            <ParamEdit label="计划开仓金额" val={s.notional?.plannedNotionalUsdt} onChange={v => patch("notional.plannedNotionalUsdt", v)} fmt={v => `$${v} USDT`} />
            <ParamEdit label="单笔上限" val={s.notional?.maxOrderNotionalUsdt} onChange={v => patch("notional.maxOrderNotionalUsdt", v)} fmt={v => `$${v} USDT`} />
            <ParamEdit label="现货最低24h成交额" val={s.universe?.minSpotVolume24hUsdt ?? 0} onChange={v => patch("universe.minSpotVolume24hUsdt", v)} fmt={v => `$${v.toLocaleString()}`} />
            <ParamEdit label="合约最低24h成交额" val={s.universe?.minPerpVolume24hUsdt ?? 0} onChange={v => patch("universe.minPerpVolume24hUsdt", v)} fmt={v => `$${v.toLocaleString()}`} />
            <ParamEdit label="动态池每个交易所上限" val={s.universe?.maxDynamicSymbolsPerExchange ?? 50} onChange={v => patch("universe.maxDynamicSymbolsPerExchange", v)} fmt={v => `${v} 个`} />
            <div className="flex justify-between items-center border-b border-gray-800 py-2">
              <span className="text-gray-400">使用动态监控池</span>
              <input type="checkbox" checked={s.universe?.useDynamicUniverse ?? false} onChange={e => patch("universe.useDynamicUniverse", e.target.checked)} className="accent-cyan-500" />
            </div>
            <div className="flex justify-between items-center border-b border-gray-800 py-2">
              <span className="text-gray-400">自动缩减（资金不足时）</span>
              <input type="checkbox" checked={s.notional?.allowAutoDownsize ?? false} onChange={e => patch("notional.allowAutoDownsize", e.target.checked)} className="accent-cyan-500" />
            </div>
          </div>
        </section>

        {/* 划转设置 */}
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-yellow-400">自动划转</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between items-center border-b border-gray-800 py-2">
              <span className="text-gray-400">启用自动划转</span>
              <input type="checkbox" checked={txAllowed} onChange={e => patch("transfer.allowAutoTransfer", e.target.checked)} className="accent-cyan-500" />
            </div>
            <div className="flex justify-between items-center border-b border-gray-800 py-2">
              <span className="text-gray-400">划转模式</span>
              <select value={txMode} onChange={e => patch("transfer.mode", e.target.value)} className="bg-gray-800 text-gray-200 text-xs border border-gray-700 px-2 py-1 rounded">
                <option value="disabled">禁用</option>
                <option value="suggest_only">仅建议</option>
                <option value="auto_transfer">自动划转</option>
              </select>
            </div>
            <ParamEdit label="单次最大自动划转" val={s.transfer?.maxAutoTransferUsdt ?? 50} onChange={v => patch("transfer.maxAutoTransferUsdt", v)} fmt={v => `$${v}`} />
            <div className="flex justify-between items-center border-b border-gray-800 py-2">
              <span className="text-gray-400">划转后重新审计</span>
              <input type="checkbox" checked={s.transfer?.requireReauditAfterTransfer ?? true} onChange={e => patch("transfer.requireReauditAfterTransfer", e.target.checked)} className="accent-cyan-500" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3 border-t border-gray-800 pt-2 leading-relaxed">
            ⚠️ 自动划转仅允许<strong className="text-yellow-300">同一交易所内部</strong>账户划转，不允许跨交易所、不允许链上提现。
            划转后必须<strong className="text-yellow-300">重新读取余额</strong>并<strong className="text-yellow-300">重新审计</strong>，不会直接下单。
          </p>
        </section>

        {/* 执行设置 */}
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-blue-400">执行设置</h3>
          <div className="text-sm space-y-2">
            <div className="flex justify-between"><span className="text-gray-400">人工确认</span><span className="text-cyan-300">{s.execution?.requireHumanApproval ? "必须" : "不必须"}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">未知订单→冻结</span><span className="text-cyan-300">{s.execution?.freezeOnUnknownOrder ? "启用" : "禁用"}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">未知划转→冻结</span><span className="text-cyan-300">{s.execution?.freezeOnUnknownTransfer ? "启用" : "禁用"}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">最大偏差容忍</span><span className="font-mono">{(s.execution?.maxLegDeviationRate ?? 0.01) * 100}%</span></div>
            <div className="flex justify-between"><span className="text-gray-400">订单超时</span><span className="font-mono">{s.execution?.orderTimeoutMs ?? 15000}ms</span></div>
          </div>
        </section>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button onClick={save} className="bg-cyan-700 hover:bg-cyan-600 text-white px-5 py-2 rounded text-sm font-medium">保存设置</button>
          <button onClick={restore} className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-5 py-2 rounded text-sm">恢复默认值</button>
        </div>
      </div>
    </div>
  );
}

function ParamEdit({ label, val, onChange, fmt }: { label: string; val: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  const [edit, setEdit] = useState(false);
  const [raw, setRaw] = useState(String(val ?? 0));
  return (
    <div className="flex justify-between items-center border-b border-gray-800 py-2">
      <span className="text-gray-400 text-xs">{label}</span>
      {edit ? (
        <input
          type="number" step="any"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={() => { onChange(Number(raw)); setEdit(false); }}
          onKeyDown={e => { if (e.key === "Enter") { onChange(Number(raw)); setEdit(false); } }}
          autoFocus
          className="bg-gray-800 text-gray-200 text-xs font-mono w-20 text-right border border-gray-700 px-1 py-0.5 rounded"
        />
      ) : (
        <button onClick={() => { setRaw(String(val ?? 0)); setEdit(true); }} className="text-gray-200 font-mono text-xs hover:text-cyan-300 cursor-pointer">
          {fmt(val ?? 0)}
        </button>
      )}
    </div>
  );
}
