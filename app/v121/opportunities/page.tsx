"use client";

import { useEffect, useState } from "react";

export default function OpportunitiesPage() {
  const [data, setData] = useState<any>(null);
  const [scanning, setScanning] = useState(false);

  const fetchOpps = () => {
    fetch("/api/v121/opportunities").then(r => r.json()).then(setData).catch(() => {});
  };

  useEffect(() => { fetchOpps(); }, []);

  const doScan = async () => {
    setScanning(true);
    await fetch("/api/v121/opportunities/scan", { method: "POST" });
    fetchOpps();
    setScanning(false);
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

      <p className="text-gray-400 mb-4 text-sm">
        只显示正 funding 期现路径 (Binance / OKX / HTX)
        {data?.mode === "READ_ONLY" && " — 只读模式，需 Worker 驱动行情数据"}
      </p>

      {data && (
        <div className="text-xs text-gray-500 mb-4 space-y-1">
          <div>最近扫描: {data.scannedAtUtc ? new Date(data.scannedAtUtc).toLocaleString("zh-CN") : "未扫描"} | 耗时: {data.durationMs ? `${data.durationMs}ms` : "—"}</div>
          <div>数据源: {data.dataSource === "real_market" ? "实时行情" : data.dataSource === "no_data" ? "无数据" : "含错误的实时行情"}</div>
          <div>总路径: {data.total ?? 0} | 通过: {data.passedCount ?? 0} | 淘汰: {data.rejectedCount ?? 0}</div>
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
            {!data?.opportunities?.length ? (
              <tr><td colSpan={11} className="py-8 text-center text-gray-500">
                暂无通过筛选的机会。<br/>
                可能原因：资金费不足、深度不足、价差不合格、数据过期或 Worker 尚未运行。<br/>
                {data?.errors?.length > 0 && (
                  <span className="text-xs text-red-400">
                    部分行情读取失败: {data.errors.map((e: any) => `${e.exchange}/${e.symbol}`).join(", ")}
                  </span>
                )}
              </td></tr>
            ) : (
              data.opportunities.map((o: any) => (
                <tr key={o.id} className="border-b border-gray-800">
                  <td className="py-2">{o.path?.symbol ?? o.symbol ?? "—"}</td>
                  <td className="py-2">{o.path?.spotExchange ?? o.spotExchange ?? "—"}</td>
                  <td className="py-2">{o.path?.perpExchange ?? o.perpExchange ?? "—"}</td>
                  <td className="py-2 text-right">{(o.funding8h * 100).toFixed(3)}%</td>
                  <td className="py-2 text-right">{(o.entryExecutableBasis * 100).toFixed(3)}%</td>
                  <td className="py-2 text-right">{o.score}</td>
                  <td className="py-2 text-center">
                    <span className={`px-2 py-0.5 text-xs font-bold ${o.level === "S" ? "text-yellow-300 bg-yellow-900/50" : o.level === "A" ? "text-green-300 bg-green-900/50" : o.level === "B" ? "text-blue-300 bg-blue-900/50" : "text-gray-400 bg-gray-800"}`}>{o.level}</span>
                  </td>
                  <td className="py-2 text-center">{o.passed ? "✅" : "❌"}</td>
                  <td className="py-2 text-xs text-gray-500">{o.rejectReasons?.map((r: any) => r.rule).join(", ") ?? "—"}</td>
                  <td className="py-2 text-xs text-gray-500">{o.warnings?.slice(0, 2).join(", ") ?? "—"}</td>
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
    </div>
  );
}
