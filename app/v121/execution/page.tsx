export default function ExecutionPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">执行中心</h2>
      <div className="grid gap-6">
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-cyan-400">纸面交易批次</h3>
          <div className="space-y-3">
            {[1, 2, 3].map((batch) => (
              <div key={batch} className="border border-gray-700 rounded p-3">
                <div className="flex justify-between mb-2">
                  <span className="font-medium">第 {batch} 批</span>
                  <span className="text-gray-400">{batch === 1 ? "30%" : batch === 2 ? "30%" : "40%"}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-sm text-gray-400">
                  <div>累计目标: {batch === 1 ? "30%" : batch === 2 ? "60%" : "100%"}</div>
                  <div>现货成交: --</div>
                  <div>合约成交: --</div>
                  <div>偏差: --</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
          <h3 className="text-lg font-semibold mb-3 text-yellow-400">执行日志</h3>
          <pre className="text-xs text-gray-500 font-mono">等待执行...</pre>
        </div>
      </div>
    </div>
  );
}
