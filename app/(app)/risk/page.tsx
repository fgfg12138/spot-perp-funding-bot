"use client";

import { useEffect, useState } from "react";

/**
 * 风控页 — 风险保护开关 + 暂停保护状态 + 异常持仓提示。
 *
 * Kill Switch 文案改为"风险保护开关"，frozen 改为"已暂停保护"。
 * 后端 /api/v121/risk/kill-switch 契约不变。
 */

const KS_LABEL: Record<string, string> = {
  OFF: "关闭",
  READ_ONLY_ONLY: "仅只读",
  PAUSE_NEW_ENTRIES: "暂停新开仓",
  PAUSE_ALL_AUTOMATION: "暂停全部",
};

const KS_ORDER = ["OFF", "READ_ONLY_ONLY", "PAUSE_NEW_ENTRIES", "PAUSE_ALL_AUTOMATION"] as const;

export default function RiskPage() {
  const [data, setData] = useState<any>(null);

  const fetchData = () => {
    fetch("/api/v121/risk").then((r) => r.json()).then(setData).catch(() => {});
  };

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 5000);
    return () => clearInterval(i);
  }, []);

  const setKS = async (state: string) => {
    await fetch("/api/v121/risk/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    fetchData();
  };

  const ks = data?.killSwitch;
  const ksLabel = ks ? (KS_LABEL[ks] ?? ks) : "—";
  const freezeLabel = data?.freezeLevel === "none" ? "无" : (data?.freezeLevel ?? "—");
  const deviations: any[] = data?.deviations ?? [];
  const frozenCount = Number(data?.frozenCount ?? 0);
  const deviationCount = Number(data?.deviationCount ?? 0);

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold">风控</h2>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <RiskCard
          label="风险保护开关"
          value={ksLabel}
          color={ks === "OFF" ? "green" : "red"}
        />
        <RiskCard
          label="暂停保护"
          value={freezeLabel}
          color={data?.freezeLevel === "none" ? "green" : "red"}
        />
        <RiskCard
          label="可交易"
          value={data?.canTrade ? "是" : "否"}
          color={data?.canTrade ? "green" : "red"}
        />
        <RiskCard
          label="需处理持仓"
          value={`${frozenCount}`}
          color={frozenCount > 0 ? "red" : "green"}
        />
        <RiskCard
          label="数量偏差告警"
          value={`${deviationCount}`}
          color={deviationCount > 0 ? "yellow" : "green"}
        />
        <RiskCard
          label="执行中"
          value={`${data?.openExecutionCount ?? 0}`}
          color="blue"
        />
      </div>

      {/* 风险保护开关 */}
      <section className="mb-4 rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="mb-3 text-lg font-semibold text-red-400">风险保护开关</h3>
        <p className="mb-3 text-xs text-gray-500">
          开启后会按等级暂停自动化操作。"暂停全部"会阻断所有自动化，切换需谨慎。
        </p>
        <div className="flex flex-wrap gap-2">
          {KS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setKS(s)}
              className={`border px-3 py-1 text-xs transition-colors ${
                ks === s
                  ? "border-cyan-400 bg-cyan-900 text-cyan-200"
                  : "border-gray-700 text-gray-400 hover:border-gray-500"
              }`}
            >
              {KS_LABEL[s]}
            </button>
          ))}
        </div>
      </section>

      {/* 异常持仓 */}
      <section className="mb-4 rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="mb-3 text-lg font-semibold text-amber-400">异常持仓</h3>
        {frozenCount === 0 && deviationCount === 0 ? (
          <p className="text-sm text-gray-500">无异常持仓，系统运行正常。</p>
        ) : (
          <div className="space-y-2 text-sm">
            {frozenCount > 0 ? (
              <p className="text-red-300">
                有 {frozenCount} 个持仓已进入暂停保护状态，需人工处理。
              </p>
            ) : null}
            {deviationCount > 0 ? (
              <p className="text-amber-300">
                有 {deviationCount} 个持仓数量偏差超限，建议前往持仓页查看。
              </p>
            ) : null}
            {deviations.length > 0 ? (
              <div className="mt-2 space-y-1">
                {deviations.map((d: any) => (
                  <div key={d.id} className="text-xs text-red-400">
                    持仓 {d.id}：偏差 {(Number(d.deviation) * 100).toFixed(2)}%
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function RiskCard({ label, value, color }: { label: string; value: string; color: string }) {
  const c =
    color === "green"
      ? "text-emerald-400"
      : color === "red"
        ? "text-red-400"
        : color === "yellow"
          ? "text-amber-400"
          : "text-blue-400";
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="text-sm text-gray-400">{label}</div>
      <div className={`text-xl font-bold ${c}`}>{value}</div>
    </div>
  );
}
