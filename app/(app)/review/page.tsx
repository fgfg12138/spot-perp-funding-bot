"use client";

import { useEffect, useState } from "react";

/**
 * 复盘页 — 历史执行记录统计。
 *
 * 展示各阶段记录数（机会、入场决策、入场执行、持仓快照、资金费结算、平仓、最终复盘）。
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
};

const TABLE_ORDER = [
  "opportunity_records",
  "entry_decisions",
  "entry_executions",
  "position_snapshots",
  "funding_settlements",
  "exit_executions",
  "final_reviews",
];

export default function ReviewPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/v121/review").then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  const persistenceLabel = data?.persistenceLabel;

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
