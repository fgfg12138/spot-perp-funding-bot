export default function RiskCenterPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">风控中心</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <RiskCard label="硬止损" value="未触发" color="green" />
        <RiskCard label="账户回撤" value="0.00%" color="green" />
        <RiskCard label="仓位偏差" value="正常" color="green" />
        <RiskCard label="ADL 风险" value="低" color="green" />
        <RiskCard label="流动性" value="正常" color="green" />
        <RiskCard label="冻结状态" value="无" color="green" />
        <RiskCard label="系统健康" value="正常" color="green" />
        <RiskCard label="告警" value="0" color="green" />
      </div>
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-3 text-red-400">风控规则状态</h3>
        <pre className="text-xs text-gray-500 font-mono">所有风控检查通过</pre>
      </div>
    </div>
  );
}

function RiskCard({ label, value, color }: { label: string; value: string; color: string }) {
  const c = color === "green" ? "text-green-400" : color === "red" ? "text-red-400" : "text-yellow-400";
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <div className="text-sm text-gray-400">{label}</div>
      <div className={`text-xl font-bold ${c}`}>{value}</div>
    </div>
  );
}
