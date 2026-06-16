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
            </tr>
          </thead>
          <tbody>
            {!data?.opportunities?.length ? (
              <tr><td colSpan={9} className="py-8 text-center text-gray-500">暂无机会 — 触发扫描获取数据</td></tr>
            ) : (
              data.opportunities.map((o: any) => (
                <tr key={o.id} className="border-b border-gray-800">
                  <td className="py-2">{o.symbol}</td>
                  <td className="py-2">{o.spotExchange}</td>
                  <td className="py-2">{o.perpExchange}</td>
                  <td className="py-2 text-right">{(o.funding8h * 100).toFixed(3)}%</td>
                  <td className="py-2 text-right">{(o.entryBasis * 100).toFixed(3)}%</td>
                  <td className="py-2 text-right">{o.score}</td>
                  <td className="py-2 text-center">
                    <span className={`px-2 py-0.5 text-xs font-bold ${o.level === "S" ? "text-yellow-300 bg-yellow-900/50" : o.level === "A" ? "text-green-300 bg-green-900/50" : o.level === "B" ? "text-blue-300 bg-blue-900/50" : "text-gray-400 bg-gray-800"}`}>{o.level}</span>
                  </td>
                  <td className="py-2 text-center">{o.passed ? "✅" : "❌"}</td>
                  <td className="py-2 text-xs text-gray-500">{o.rejectReasons?.map((r: any) => r.rule).join(", ")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
