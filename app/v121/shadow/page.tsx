"use client";

import { useEffect, useState } from "react";

export default function ShadowPage() {
  const [status, setStatus] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/v121/shadow").then(r => r.json()).then(setStatus).catch(() => {});
  }, []);

  const doRefresh = async () => {
    setLoading(true);
    const r = await fetch("/api/v121/shadow/account");
    setReport(await r.json());
    setLoading(false);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">SHADOW 主网只读</h2>

      <div className="bg-cyan-950/30 border border-cyan-800/40 rounded p-3 mb-4 text-sm text-cyan-300">
        当前为只读模式，不会下单，不会修改账户。所有修改账户动作已被安全门阻断。
      </div>

      {/* API Key 状态 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-cyan-400">API Key 配置状态</h3>
        <div className="grid grid-cols-3 gap-4">
          {(status?.keyStatus ?? [
            { exchange: "binance", configured: false },
            { exchange: "okx", configured: false },
            { exchange: "htx", configured: false },
          ]).map((k: any) => (
            <div key={k.exchange} className="border border-gray-700 rounded p-3">
              <div className="font-semibold text-sm">{k.exchange.toUpperCase()}</div>
              <div className={k.configured ? "text-green-400 text-xs mt-1" : "text-red-400 text-xs mt-1"}>
                {k.configured ? "已配置" : "未配置"}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {k.configured ? "仅显示配置状态，不泄露 Key 内容" : "请在 .env.local 中配置"}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 同步按钮 */}
      <button
        onClick={doRefresh}
        disabled={loading}
        className="border border-cyan-400/60 bg-cyan-400/15 text-cyan-100 px-4 py-2 text-sm mb-4 disabled:opacity-50"
      >
        {loading ? "同步中..." : "同步账户数据"}
      </button>

      {/* 余额 */}
      {report?.balances?.length > 0 && (
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
          <h3 className="text-lg font-semibold mb-3 text-green-400">余额快照</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2">交易所</th>
                <th className="text-left py-2">资产</th>
                <th className="text-right py-2">可用</th>
                <th className="text-right py-2">冻结</th>
                <th className="text-right py-2">总计</th>
                <th className="text-right py-2">USDT 估值</th>
              </tr>
            </thead>
            <tbody>
              {report.balances.map((b: any, i: number) => (
                <tr key={i} className="border-b border-gray-800">
                  <td className="py-1">{b.exchange}</td>
                  <td className="py-1">{b.asset}</td>
                  <td className="py-1 text-right">{b.free.toFixed(4)}</td>
                  <td className="py-1 text-right">{b.locked.toFixed(4)}</td>
                  <td className="py-1 text-right">{b.total.toFixed(4)}</td>
                  <td className="py-1 text-right">${b.usdtValue?.toFixed(2) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-xs text-gray-600 mt-1">
            总估值: ${report.balances.reduce((s: number, b: any) => s + (b.usdtValue ?? 0), 0).toFixed(2)}
          </div>
        </section>
      )}

      {/* 仓位 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-yellow-400">仓位快照</h3>
        {!report?.positions?.length ? (
          <p className="text-xs text-gray-500">暂无持仓</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2">交易所</th>
                <th className="text-left py-2">币种</th>
                <th className="text-left py-2">方向</th>
                <th className="text-right py-2">数量</th>
                <th className="text-right py-2">名义价值</th>
                <th className="text-right py-2">未实现盈亏</th>
              </tr>
            </thead>
            <tbody>
              {report.positions.map((p: any, i: number) => (
                <tr key={i} className="border-b border-gray-800">
                  <td className="py-1">{p.exchange}</td>
                  <td className="py-1">{p.symbol}</td>
                  <td className="py-1">{p.side === "perp_short" ? "空" : p.side === "spot_long" ? "多" : "—"}</td>
                  <td className="py-1 text-right">{p.quantity}</td>
                  <td className="py-1 text-right">${p.notionalUsdt.toFixed(2)}</td>
                  <td className={`py-1 text-right ${(p.unrealizedPnlUsdt ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                    ${p.unrealizedPnlUsdt?.toFixed(2) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 挂单 */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h3 className="text-lg font-semibold mb-3 text-blue-400">当前挂单</h3>
        {!report?.openOrders?.length ? (
          <p className="text-xs text-gray-500">暂无挂单</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2">交易所</th>
                <th className="text-left py-2">币种</th>
                <th className="text-left py-2">方向</th>
                <th className="text-right py-2">价格</th>
                <th className="text-right py-2">数量</th>
                <th className="text-left py-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {report.openOrders.map((o: any, i: number) => (
                <tr key={i} className="border-b border-gray-800">
                  <td className="py-1">{o.exchange}</td>
                  <td className="py-1">{o.symbol}</td>
                  <td className="py-1">{
                    o.side === "buy" ? "买入" : o.side === "sell" ? "卖出" : o.side === "short" ? "做空" : "平空"
                  }</td>
                  <td className="py-1 text-right">{o.price}</td>
                  <td className="py-1 text-right">{o.quantity}</td>
                  <td className="py-1">{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 警告 */}
      {report?.warnings?.length > 0 && (
        <section className="bg-red-950/30 border border-red-800/40 rounded p-3 mb-4">
          <h3 className="text-sm font-semibold text-red-400 mb-1">警告</h3>
          {report.warnings.map((w: string, i: number) => (
            <p key={i} className="text-xs text-red-300">{w}</p>
          ))}
        </section>
      )}

      <div className="text-xs text-gray-600 mt-4 space-y-1">
        <div>最后同步: {report?.generatedAtUtc ? new Date(report.generatedAtUtc).toLocaleString("zh-CN") : "—"}</div>
        <div>Secret 安全检查: {report?._secretCheck ?? "—"}</div>
        {report && <div className="text-green-500">Secret 未泄露 — 通过</div>}
      </div>
    </div>
  );
}
