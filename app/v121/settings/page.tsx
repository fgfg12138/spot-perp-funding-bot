export default function SettingsPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">参数中心</h2>
      <div className="grid gap-6">
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-cyan-400">系统模式</h3>
          <div className="flex gap-2">
            {(["READ_ONLY", "PAPER", "SHADOW", "TESTNET", "LIVE"] as const).map((mode) => (
              <span key={mode} className={`px-3 py-1 rounded text-sm font-medium ${
                mode === "READ_ONLY" ? "bg-cyan-900 text-cyan-300" : "bg-gray-800 text-gray-500"
              }`}>{mode}</span>
            ))}
          </div>
        </section>

        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-green-400">参数表</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <ParamRow label="最低 funding_8h" value="0.05%" />
            <ParamRow label="异常 funding_8h" value=">0.30%" />
            <ParamRow label="禁止开仓 funding" value=">0.50%" />
            <ParamRow label="现货最低成交额" value="$1M" />
            <ParamRow label="合约最低成交额" value="$5M" />
            <ParamRow label="现货最大价差" value="0.10%" />
            <ParamRow label="合约最大价差" value="0.08%" />
            <ParamRow label="宽价差降级" value=">0.30%" />
            <ParamRow label="批次比例" value="30/30/40" />
            <ParamRow label="偏差容忍" value="≤1%" />
          </div>
        </section>
      </div>
    </div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-gray-800 py-2">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-200 font-mono">{value}</span>
    </div>
  );
}
