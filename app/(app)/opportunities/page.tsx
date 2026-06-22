"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * 机会页 — 成品套利机会列表。
 *
 * 每个机会只展示三态：可开仓 / 观察中 / 不符合条件。
 * 不显示 dataSource / scanMode / rehearsal candidate / intent 等工程概念。
 * 工程字段 funding_8h 改成"资金费率"，entryExecutableBasis 改成"开仓基差"。
 */

function fmtNum(v: unknown, digits = 2, fallback = "—") {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

/**
 * 三态归类：
 * - 可开仓：硬过滤 + 净收益全部通过 (o.passed)
 * - 观察中：未通过但有 A/B 级评分（值得持续观察，未硬拒）
 * - 不符合条件：硬过滤淘汰或 C 级
 */
function classifyOpp(o: any): { status: "可开仓" | "观察中" | "不符合条件"; tone: "green" | "yellow" | "slate" } {
  if (o.passed) return { status: "可开仓", tone: "green" };
  const level = o.level ?? "C";
  if (level === "A" || level === "B") return { status: "观察中", tone: "yellow" };
  return { status: "不符合条件", tone: "slate" };
}

export default function OpportunitiesPage() {
  const [data, setData] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const fetchOpps = () => {
    fetch("/api/v121/opportunities").then((r) => r.json()).then(setData).catch(() => {});
  };

  useEffect(() => {
    fetchOpps();
    const i = setInterval(fetchOpps, 15000);
    return () => clearInterval(i);
  }, []);

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
      setData(result);
    } catch (err) {
      setScanError(String(err));
    } finally {
      setScanning(false);
    }
  };

  const allOpps: any[] = data?.opportunities ?? [];
  // 排序：可开仓 > 观察中 > 不符合条件；同级按评分降序
  const sorted = [...allOpps].sort((a, b) => {
    const ra = classifyOpp(a).status;
    const rb = classifyOpp(b).status;
    const rank: Record<string, number> = { 可开仓: 0, 观察中: 1, 不符合条件: 2 };
    if (rank[ra] !== rank[rb]) return rank[ra] - rank[rb];
    return (b.score ?? 0) - (a.score ?? 0);
  });

  const openableCount = allOpps.filter((o) => o.passed).length;
  const observeCount = allOpps.filter((o) => {
    const c = classifyOpp(o);
    return c.status === "观察中";
  }).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">机会</h2>
        <button
          onClick={doScan}
          disabled={scanning}
          className="border border-cyan-400/60 bg-cyan-400/15 px-3 py-1 text-sm text-cyan-100 transition-colors hover:bg-cyan-400/25 disabled:opacity-50"
        >
          {scanning ? "扫描中..." : "立即扫描"}
        </button>
      </div>

      {scanError ? (
        <div className="mb-4 rounded border border-red-800/40 bg-red-950/30 p-2 text-xs text-red-300">
          扫描失败：{scanError}
        </div>
      ) : null}

      {data ? (
        <div className="mb-4 text-xs text-gray-500">
          <span className="text-emerald-400">可开仓 {openableCount}</span>
          {" · "}
          <span className="text-amber-400">观察中 {observeCount}</span>
          {" · "}
          <span>共 {allOpps.length} 条</span>
          {data.scannedAtUtc
            ? ` · 最近扫描 ${new Date(data.scannedAtUtc).toLocaleString("zh-CN")}`
            : ""}
        </div>
      ) : null}

      {openableCount > 0 ? (
        <div className="mb-4 rounded border border-emerald-800/50 bg-emerald-950/20 p-3 text-sm text-emerald-200">
          有 {openableCount} 个可开仓机会，可前往
          <Link href="/trade/open" className="mx-1 underline hover:text-emerald-100">开仓页</Link>
          处理。
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="py-2 text-left">币种</th>
              <th className="py-2 text-left">现货所</th>
              <th className="py-2 text-left">合约所</th>
              <th className="py-2 text-right">资金费率</th>
              <th className="py-2 text-right">开仓基差</th>
              <th className="py-2 text-right">风险等级</th>
              <th className="py-2 text-center">状态</th>
              <th className="py-2 text-left">说明</th>
            </tr>
          </thead>
          <tbody>
            {!sorted.length ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-500">
                  当前没有符合条件的套利机会，系统会继续自动监控。
                </td>
              </tr>
            ) : (
              sorted.slice(0, 100).map((o: any) => {
                const cls = classifyOpp(o);
                const toneClass = {
                  green: "text-emerald-300 bg-emerald-900/40 border-emerald-700/40",
                  yellow: "text-amber-300 bg-amber-900/40 border-amber-700/40",
                  slate: "text-gray-400 bg-gray-800/60 border-gray-700",
                }[cls.tone];
                const reason = o.rejectReasons?.length
                  ? o.rejectReasons.map((r: any) => r.rule).join("、")
                  : o.warnings?.slice(0, 1).join("、") ?? "—";
                return (
                  <tr
                    key={o.id}
                    className={`border-b border-gray-800 ${o.passed ? "" : "opacity-70"}`}
                  >
                    <td className="py-1 font-semibold">{o.path?.symbol ?? o.symbol ?? "—"}</td>
                    <td className="py-1 text-gray-300">{o.path?.spotExchange ?? "—"}</td>
                    <td className="py-1 text-gray-300">{o.path?.perpExchange ?? "—"}</td>
                    <td className="py-1 text-right tabular-nums">
                      {fmtNum(Number(o.funding8h) * 100, 3)}%
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {fmtNum(Number(o.entryExecutableBasis) * 100, 3)}%
                    </td>
                    <td className="py-1 text-center">
                      <span
                        className={`px-1.5 py-0.5 text-xs font-bold ${
                          o.level === "S"
                            ? "text-yellow-300 bg-yellow-900/50"
                            : o.level === "A"
                              ? "text-emerald-300 bg-emerald-900/50"
                              : o.level === "B"
                                ? "text-blue-300 bg-blue-900/50"
                                : "text-gray-500 bg-gray-800"
                        }`}
                      >
                        {o.level ?? "—"}
                      </span>
                    </td>
                    <td className="py-1 text-center">
                      <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${toneClass}`}>
                        {cls.status}
                      </span>
                    </td>
                    <td className="py-1 text-xs text-gray-500">{reason}</td>
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
