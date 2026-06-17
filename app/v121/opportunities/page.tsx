"use client";

import { useEffect, useState } from "react";

export default function OpportunitiesPage() {
  const [data, setData] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [rehearsal, setRehearsal] = useState<any>(null);
  const [rehearsalLoading, setRehearsalLoading] = useState(false);

  const fetchOpps = () => {
    fetch("/api/v121/opportunities").then(r => r.json()).then(setData).catch(() => {});
  };

  useEffect(() => { fetchOpps(); fetchRehearsal(); }, []);

  const fetchRehearsal = () => {
    fetch("/api/v121/opportunities/rehearsal-candidate").then(r => r.json()).then(d => {
      if (d.id) setRehearsal(d);
    }).catch(() => {});
  };

  const doScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch("/api/v121/opportunities/scan", { method: "POST" });
      const result = await res.json();
      if (!res.ok) {
        setScanError(result.error ? `${result.error}: ${result.detail || ""}` : `HTTP ${res.status}`);
        return;
      }
      fetchOpps();
    } catch (err) {
      setScanError(String(err));
    } finally {
      setScanning(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">机会池</h2>
        <button
          onClick={doScan}
          disabled={scanning}
          className="border border-cyan-400/60 bg-cyan-400/15 text-cyan-100 px-3 py-1 text-sm disabled:opacity-50"
        >
          {scanning ? "扫描中..." : "触发扫描"}
        </button>
      </div>

      {scanError && (
        <div className="bg-red-950/30 border border-red-800/40 rounded p-2 mb-4 text-xs text-red-300">
          扫描失败: {scanError}
        </div>
      )}

      <p className="text-gray-400 mb-4 text-sm">
        只显示正 funding 期现路径 (Binance / OKX / HTX)
        {data?.mode === "READ_ONLY" && " — 只读模式，需 Worker 驱动行情数据"}
      </p>

      {data && (
        <div className="text-xs text-gray-500 mb-4 space-y-1">
          <div>最近扫描: {data.scannedAtUtc ? new Date(data.scannedAtUtc).toLocaleString("zh-CN") : "未扫描"} | 耗时: {data.durationMs ? `${data.durationMs}ms` : "—"}</div>
          <div>数据源: {data.dataSource === "real_market" ? "实时行情" : data.dataSource === "no_data" ? "无数据" : "含错误的实时行情"}</div>
          <div>总路径: {data.totalPaths ?? data.total ?? 0} | 通过: {data.passedCount ?? 0} | 淘汰: {data.rejectedCount ?? 0}</div>
          {data.rejectSummary && Object.keys(data.rejectSummary).length > 0 && (
            <div>主要淘汰原因: {Object.entries(data.rejectSummary as Record<string, number>).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(", ")}</div>
          )}
          {data.errors?.length > 0 && (
            <div className="text-red-400">读取错误: {data.errors.map((e: any) => `${e.exchange}/${e.symbol}`).join(", ")}</div>
          )}
        </div>
      )}

      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2">币种</th>
              <th className="text-left py-2">现货</th>
              <th className="text-left py-2">合约</th>
              <th className="text-right py-2">funding_8h</th>
              <th className="text-right py-2">开仓基差</th>
              <th className="text-right py-2">评分</th>
              <th className="text-center py-2">等级</th>
              <th className="text-center py-2">通过</th>
              <th className="text-left py-2">淘汰原因</th>
              <th className="text-left py-2">风险标签</th>
            </tr>
          </thead>
          <tbody>
            {!data?.opportunities?.length && data?.dataSource !== "no_data" ? (
              <tr><td colSpan={10} className="py-8 text-center text-gray-500">
                暂无扫描结果。请点击"触发扫描"获取数据。
              </td></tr>
            ) : (
              data.opportunities.slice(0, 100).map((o: any) => (
                <tr key={o.id} className={`border-b border-gray-800 ${o.passed ? "" : "opacity-50"}`}>
                  <td className="py-1">{o.path?.symbol ?? o.symbol ?? "—"}</td>
                  <td className="py-1">{o.path?.spotExchange ?? o.spotExchange ?? "—"}</td>
                  <td className="py-1">{o.path?.perpExchange ?? o.perpExchange ?? "—"}</td>
                  <td className="py-1 text-right">{(o.funding8h * 100).toFixed(3)}%</td>
                  <td className="py-1 text-right">{(o.entryExecutableBasis * 100).toFixed(3)}%</td>
                  <td className="py-1 text-right">{o.score ?? "—"}</td>
                  <td className="py-1 text-center">
                    <span className={`px-1.5 py-0.5 text-xs font-bold ${
                      o.level === "S" ? "text-yellow-300 bg-yellow-900/50" :
                      o.level === "A" ? "text-green-300 bg-green-900/50" :
                      o.level === "B" ? "text-blue-300 bg-blue-900/50" :
                      "text-gray-500 bg-gray-800"
                    }`}>{o.level ?? "—"}</span>
                  </td>
                  <td className="py-1 text-center">{o.passed ? "✅" : "❌"}</td>
                  <td className="py-1 text-xs text-gray-500">{o.rejectReasons?.map((r: any) => r.rule).join(", ") ?? "—"}</td>
                  <td className="py-1 text-xs text-gray-500">{o.warnings?.slice(0, 2).join(", ") ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {data && (
          <div className="text-xs text-gray-600 mt-2 space-y-1">
            <div>数据源: {data.dataSource ?? "—"} | 扫描时间: {data.scannedAtUtc ? new Date(data.scannedAtUtc).toLocaleString("zh-CN") : "—"}</div>
            <div>总路径: {data.total} | 通过: {data.passedCount} | 淘汰: {data.rejectedCount}</div>
          </div>
        )}
      </div>

      {/* 执行链路模拟候选 */}
      {rehearsal && (
        <div className="bg-gray-900 rounded-lg border border-amber-800/60 p-4 mt-4">
          <h3 className="text-lg font-semibold mb-3 text-amber-400">🔧 执行链路模拟候选</h3>
          <div className="bg-amber-950/30 border border-amber-700/50 rounded p-2 mb-3 text-xs text-amber-300">
            ⚠️ 该候选仅用于模拟测试，不满足正式套利门槛，不允许真实下单。
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
            <div><span className="text-gray-400">币种:</span> {rehearsal.symbol}</div>
            <div><span className="text-gray-400">交易所:</span> {rehearsal.exchange}</div>
            <div><span className="text-gray-400">funding_8h:</span> {(rehearsal.funding8h * 100).toFixed(3)}%</div>
            <div><span className="text-gray-400">预期净收益:</span> <span className={rehearsal.expectedNetRate >= 0 ? "text-green-400" : "text-red-400"}>{(rehearsal.expectedNetRate * 100).toFixed(3)}%</span></div>
            <div><span className="text-gray-400">手续费估算:</span> {rehearsal.feeCostEstimate?.toFixed(4) ?? "—"}</div>
            <div><span className="text-gray-400">simulationOnly:</span> <span className="text-amber-400">true</span></div>
          </div>
          <button
            onClick={async () => {
              setRehearsalLoading(true);
              const r = await fetch("/api/v121/opportunities/rehearsal-candidate/dry-run-intent", { method: "POST" });
              const d = await r.json();
              const msg = d.intentId
                ? `Dry-run intent 已生成: ${d.intentId}`
                : `失败: ${d.error || "未知"}\n${d.detail || ""}\n${d.stack || ""}`;
              alert(msg);
              setRehearsalLoading(false);
            }}
            disabled={rehearsalLoading}
            className="border border-amber-400/60 bg-amber-400/15 text-amber-100 px-3 py-1 text-xs disabled:opacity-50"
          >
            {rehearsalLoading ? "生成中..." : "生成 dry-run intent"}
          </button>
          {rehearsal.chineseMessage && (
            <div className="text-xs text-gray-500 mt-2">{rehearsal.chineseMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
