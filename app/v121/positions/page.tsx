"use client";

import { useEffect, useState } from "react";

export default function PositionsPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/v121/positions").then(r => r.json()).then(setData).catch(() => {});
    const i = setInterval(() => fetch("/api/v121/positions").then(r => r.json()).then(setData).catch(() => {}), 5000);
    return () => clearInterval(i);
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">持仓监控</h2>
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2">币种</th>
              <th className="text-left py-2">路径</th>
              <th className="text-right py-2">状态</th>
              <th className="text-right py-2">现货名义</th>
              <th className="text-right py-2">合约名义</th>
              <th className="text-right py-2">偏差</th>
              <th className="text-right py-2">基差</th>
              <th className="text-center py-2">建议</th>
            </tr>
          </thead>
          <tbody>
            {!data?.positions?.length ? (
              <tr><td colSpan={8} className="py-8 text-center text-gray-500">暂无持仓 — 创建 Paper 执行并完成 3 批后自动出现</td></tr>
            ) : (
              data.positions.map((p: any) => (
                <tr key={p.id} className="border-b border-gray-800">
                  <td className="py-2 font-semibold">{p.symbol}</td>
                  <td className="py-2 text-gray-400">{p.spotExchange}→{p.perpExchange}</td>
                  <td className={`py-2 text-right ${p.state === "MONITORING" ? "text-green-400" : "text-yellow-400"}`}>{p.state}</td>
                  <td className="py-2 text-right">${p.spotNotional.toFixed(0)}</td>
                  <td className="py-2 text-right">${p.perpNotional.toFixed(0)}</td>
                  <td className={`py-2 text-right ${p.positionDeviation > 0.01 ? "text-red-400" : "text-green-400"}`}>{(p.positionDeviation * 100).toFixed(2)}%</td>
                  <td className="py-2 text-right">{(p.actualBasis * 100).toFixed(3)}%</td>
                  <td className="py-2 text-center">{p.positionDeviation > 0.05 ? "⚠️ 修复" : p.positionDeviation > 0.01 ? "📋 观察" : "✅ 持有"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {data?.dataSource && <div className="text-xs text-gray-600 mt-2">数据源: {data.dataSource}</div>}
      </div>
    </div>
  );
}
