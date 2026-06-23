"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * 持仓页 — 当前持仓监控。
 *
 * 展示币种、路径、状态、现货/合约名义、数量偏差、基差、建议。
 * 默认隐藏已平仓记录，可切换"显示已平仓"查看历史闭环。
 * 工程字段（state、dataSource）翻译成用户语言；空状态引导到开仓/平仓页。
 */

/** 持仓状态翻译成用户语言 + 语气色。 */
function stateLabel(state: string): { text: string; tone: string } {
  switch (state) {
    case "MONITORING":
      return { text: "监控中", tone: "text-cyan-300" };
    case "OPEN":
      return { text: "持有中", tone: "text-emerald-300" };
    case "EXITING":
      return { text: "平仓中", tone: "text-amber-300" };
    case "FROZEN":
      return { text: "已暂停保护", tone: "text-red-300" };
    case "CLOSED":
      return { text: "已平仓", tone: "text-gray-400" };
    case "FAILED":
      return { text: "开仓失败", tone: "text-red-300" };
    default:
      return { text: state ?? "—", tone: "text-gray-400" };
  }
}

/** 根据状态 + 数量偏差给出建议。 */
function suggest(state: string, deviation: number): { text: string; tone: string } {
  if (state === "CLOSED") return { text: "已完结", tone: "text-gray-400" };
  if (state === "EXITING") return { text: "平仓中", tone: "text-amber-400" };
  if (state === "FROZEN") return { text: "需处理", tone: "text-red-400" };
  if (deviation > 0.05) return { text: "需修复", tone: "text-red-400" };
  if (deviation > 0.01) return { text: "观察中", tone: "text-amber-400" };
  return { text: "持有", tone: "text-emerald-400" };
}

export default function PositionsPage() {
  const [data, setData] = useState<any>(null);
  const [includeClosed, setIncludeClosed] = useState(false);

  useEffect(() => {
    const fetchAll = () => {
      const qs = includeClosed ? "?include=closed" : "";
      fetch(`/api/v121/positions${qs}`).then((r) => r.json()).then(setData).catch(() => {});
    };
    fetchAll();
    const i = setInterval(fetchAll, 5000);
    return () => clearInterval(i);
  }, [includeClosed]);

  const positions: any[] = data?.positions ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">持仓</h2>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-gray-400">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(e) => setIncludeClosed(e.target.checked)}
              className="accent-cyan-500"
            />
            显示已平仓
          </label>
          <Link
            href="/trade/open"
            className="border border-cyan-500/60 bg-cyan-500/15 px-3 py-1 text-cyan-100 transition-colors hover:bg-cyan-500/25"
          >
            开仓
          </Link>
          <Link
            href="/trade/close"
            className="border border-amber-500/60 bg-amber-500/15 px-3 py-1 text-amber-100 transition-colors hover:bg-amber-500/25"
          >
            平仓
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="py-2 text-left">币种</th>
              <th className="py-2 text-left">路径</th>
              <th className="py-2 text-right">现货数量</th>
              <th className="py-2 text-right">合约空单</th>
              <th className="py-2 text-right">数量偏差</th>
              <th className="py-2 text-right">基差</th>
              <th className="py-2 text-center">状态</th>
              <th className="py-2 text-center">建议</th>
            </tr>
          </thead>
          <tbody>
            {!positions.length ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-500">
                  {includeClosed
                    ? "暂无记录。完成开仓后此处显示持仓与平仓历史。"
                    : "暂无持仓。完成开仓后此处显示持仓，并可前往平仓页生成平仓预案。"}
                </td>
              </tr>
            ) : (
              positions.map((p: any) => {
                const deviation = Number(p.positionDeviation ?? 0);
                const st = stateLabel(p.state);
                const suggestion = suggest(p.state, deviation);
                const dim = p.state === "CLOSED" ? "opacity-60" : "";
                return (
                  <tr key={p.id} className={`border-b border-gray-800 ${dim}`}>
                    <td className="py-2 font-semibold">{p.symbol}</td>
                    <td className="py-2 text-gray-400">{p.spotExchange}→{p.perpExchange}</td>
                    <td className="py-2 text-right tabular-nums">
                      {p.spotFilledQty != null ? Number(p.spotFilledQty).toFixed(6) : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {p.perpFilledQty != null ? Number(p.perpFilledQty).toFixed(6) : "—"}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        deviation > 0.01 ? "text-red-400" : "text-emerald-400"
                      }`}
                    >
                      {(deviation * 100).toFixed(2)}%
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {(Number(p.actualBasis ?? 0) * 100).toFixed(3)}%
                    </td>
                    <td className={`py-2 text-center ${st.tone}`}>{st.text}</td>
                    <td className={`py-2 text-center ${suggestion.tone}`}>{suggestion.text}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
