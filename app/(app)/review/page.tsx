"use client";

import { useEffect, useState } from "react";

/**
 * 复盘页 — 历史执行记录统计。
 *
 * 展示各阶段记录数（机会、入场决策、入场执行、持仓快照、资金费结算、平仓、最终复盘），
 * 以及平仓闭环的方案与执行记录（close_plans / close_executions）。
 * 平仓执行明细展示状态、净收益、平仓后验证、保护原因。
 * 持久化引擎状态用用户语言标注，不暴露工程细节。
 */

const TABLE_LABELS: Record<string, string> = {
  opportunity_records: "机会记录",
  entry_decisions: "入场决策",
  entry_executions: "入场执行",
  position_snapshots: "持仓快照",
  funding_settlements: "资金费结算",
  exit_executions: "平仓记录",
  final_reviews: "最终复盘",
  close_plans: "平仓方案",
  close_executions: "平仓执行",
};

const TABLE_ORDER = [
  "opportunity_records",
  "entry_decisions",
  "entry_executions",
  "position_snapshots",
  "funding_settlements",
  "exit_executions",
  "final_reviews",
  "close_plans",
  "close_executions",
];

/** 平仓执行状态码 → 用户语言。与后端 CLOSE_STATUS_LABEL 对齐。 */
function closeStatusLabel(status: string): { text: string; tone: string } {
  switch (status) {
    case "closed":
      return { text: "已平仓", tone: "text-emerald-300" };
    case "protected":
      return { text: "已暂停保护", tone: "text-red-300" };
    case "failed":
      return { text: "平仓失败", tone: "text-red-300" };
    case "prechecked":
      return { text: "校验通过", tone: "text-cyan-300" };
    case "perp_submitted":
    case "perp_filled":
    case "spot_submitted":
    case "spot_filled":
      return { text: "平仓处理中", tone: "text-amber-300" };
    default:
      return { text: status ?? "—", tone: "text-gray-400" };
  }
}

export default function ReviewPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/v121/review").then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  const persistenceLabel = data?.persistenceLabel;
  const closeExecutions: any[] = data?.close_executions ?? [];

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold">复盘</h2>

      {persistenceLabel ? (
        <div className="mb-4 rounded border border-amber-800/40 bg-amber-950/30 p-3 text-xs text-amber-300">
          {persistenceLabel}
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <ReviewCard label="总记录数" value={String(data?.totalRecords ?? 0)} />
        {TABLE_ORDER.map((t) => (
          <ReviewCard key={t} label={TABLE_LABELS[t]} value={`${data?.[t]?.length ?? 0}`} />
        ))}
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="mb-3 text-lg font-semibold text-purple-400">记录明细</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="py-2 text-left">类别</th>
              <th className="py-2 text-right">记录数</th>
            </tr>
          </thead>
          <tbody>
            {TABLE_ORDER.map((t) => (
              <tr key={t} className="border-b border-gray-800">
                <td className="py-2">{TABLE_LABELS[t]}</td>
                <td className="py-2 text-right tabular-nums">{data?.[t]?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-600">
          存储状态：{data?.persistence ? "正常" : "未初始化"}
        </p>
      </div>

      {/* 平仓执行明细 — 闭环追溯 */}
      <div className="mt-6 rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="mb-3 text-lg font-semibold text-amber-300">平仓执行明细</h3>
        {!closeExecutions.length ? (
          <p className="py-6 text-center text-sm text-gray-500">
            暂无平仓执行记录。完成平仓后此处展示状态、净收益与平仓后验证。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="py-2 text-left">币种</th>
                  <th className="py-2 text-left">状态</th>
                  <th className="py-2 text-right">净收益(USDT)</th>
                  <th className="py-2 text-center">平仓后验证</th>
                  <th className="py-2 text-left">保护原因</th>
                  <th className="py-2 text-left">时间</th>
                </tr>
              </thead>
              <tbody>
                {closeExecutions.map((e: any) => {
                  const st = closeStatusLabel(e.status);
                  const pnl = e.finalPnlEstimate?.netProfit;
                  const verification = e.verification;
                  const verified =
                    verification &&
                    verification.perpShortCleared &&
                    verification.spotBalanceReduced &&
                    verification.executedQtyMatched;
                  return (
                    <tr key={e.id} className="border-b border-gray-800">
                      <td className="py-2 font-semibold">{e.symbol}</td>
                      <td className={`py-2 ${st.tone}`}>{st.text}</td>
                      <td className="py-2 text-right tabular-nums">
                        {typeof pnl === "number" ? pnl.toFixed(4) : "—"}
                      </td>
                      <td className="py-2 text-center">
                        {verification ? (
                          <span className={verified ? "text-emerald-300" : "text-red-300"}>
                            {verified ? "通过" : "有差异"}
                          </span>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                      <td className="py-2 text-red-300">
                        {e.frozenReason ? e.frozenReason : "—"}
                      </td>
                      <td className="py-2 text-gray-500 tabular-nums">
                        {e.createdAtUtc ? e.createdAtUtc.slice(0, 19).replace("T", " ") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="text-xl font-bold text-purple-400">{value}</div>
    </div>
  );
}
