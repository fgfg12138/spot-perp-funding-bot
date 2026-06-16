"use client";

import { useEffect, useState } from "react";

export default function ExecutionPage() {
  const [execs, setExecs] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [idInput, setIdInput] = useState("");

  const fetchList = () => {
    fetch("/api/v121/executions/paper").then(r => r.json()).then(d => setExecs(d.executions ?? [])).catch(() => {});
  };

  useEffect(() => { fetchList(); const i = setInterval(fetchList, 5000); return () => clearInterval(i); }, []);

  const loadDetail = async (id: string) => {
    const r = await fetch(`/api/v121/executions/paper/${id}`);
    setDetail(await r.json());
  };

  const doAction = async (id: string, action: string, body?: any) => {
    await fetch(`/api/v121/executions/paper/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    fetchList();
    loadDetail(id);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">执行中心</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-cyan-400">纸面交易列表</h3>
          {execs.length === 0 ? (
            <p className="text-gray-500 text-sm">暂无执行记录</p>
          ) : (
            <div className="space-y-2">
              {execs.map(e => (
                <div key={e.id} className="border border-gray-700 rounded p-2 cursor-pointer hover:border-cyan-700" onClick={() => loadDetail(e.id)}>
                  <div className="flex justify-between text-sm">
                    <span>{e.symbol} ({e.spotExchange}→{e.perpExchange})</span>
                    <span className={e.state === "FROZEN" ? "text-red-400" : e.state === "OPEN" ? "text-green-400" : "text-gray-400"}>{e.state}</span>
                  </div>
                  <div className="text-xs text-gray-500">偏差: {(e.positionDeviation * 100).toFixed(2)}% | 现货: ${e.spotNotional} | 合约: ${e.perpNotional}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-yellow-400">执行详情</h3>
          {!detail ? (
            <p className="text-gray-500 text-sm">点击左侧执行记录查看详情</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>ID: <span className="text-gray-400 font-mono text-xs">{detail.id}</span></div>
              <div>状态: <span className="font-bold text-cyan-400">{detail.state}</span></div>
              <div>偏差: <span className={detail.positionDeviation > 0.01 ? "text-red-400" : "text-green-400"}>{(detail.positionDeviation * 100).toFixed(2)}%</span></div>
              <div>现货: ${detail.spotNotional} | 合约: ${detail.perpNotional}</div>
              <div className="flex flex-wrap gap-2 mt-3">
                {detail.state === "PRECHECK" && (
                  <button className="bg-cyan-900 text-cyan-200 px-3 py-1 text-xs" onClick={() => doAction(detail.id, "batch", { batchNo: 1, spotFill: { qty: 0.013, avgPrice: 65000, notional: 900 }, perpFill: { qty: 0.013, avgPrice: 65020, notional: 900 } })}>执行第1批</button>
                )}
                {detail.state === "BATCH_1_CONFIRMED" && (
                  <button className="bg-cyan-900 text-cyan-200 px-3 py-1 text-xs" onClick={() => doAction(detail.id, "batch", { batchNo: 2, spotFill: { qty: 0.013, avgPrice: 65000, notional: 900 }, perpFill: { qty: 0.013, avgPrice: 65020, notional: 900 } })}>执行第2批</button>
                )}
                {detail.state === "BATCH_2_CONFIRMED" && (
                  <button className="bg-cyan-900 text-cyan-200 px-3 py-1 text-xs" onClick={() => doAction(detail.id, "batch", { batchNo: 3, spotFill: { qty: 0.018, avgPrice: 65000, notional: 1200 }, perpFill: { qty: 0.018, avgPrice: 65020, notional: 1200 } })}>执行第3批</button>
                )}
                {detail.state === "BATCH_3_CONFIRMED" && (
                  <button className="bg-green-900 text-green-200 px-3 py-1 text-xs" onClick={() => doAction(detail.id, "open")}>开仓</button>
                )}
                {["OPEN", "MONITORING"].includes(detail.state) && (
                  <button className="bg-amber-900 text-amber-200 px-3 py-1 text-xs" onClick={() => doAction(detail.id, "exit", { reason: "手动平仓" })}>平仓</button>
                )}
                {!["CLOSED", "FAILED"].includes(detail.state) && (
                  <button className="bg-red-900 text-red-200 px-3 py-1 text-xs" onClick={() => doAction(detail.id, "cancel", { reason: "用户取消" })}>取消/冻结</button>
                )}
              </div>
              <details className="mt-3">
                <summary className="text-xs text-gray-500 cursor-pointer">日志</summary>
                <pre className="text-xs text-gray-600 mt-1 max-h-32 overflow-auto">{detail.logs?.join("\n")}</pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
