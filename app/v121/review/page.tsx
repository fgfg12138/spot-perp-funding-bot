export default function ReviewPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">复盘中心</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <ReviewCard label="总净收益" value="$0.00" />
        <ReviewCard label="资金费兑现率" value="--" />
        <ReviewCard label="基差兑现率" value="--" />
        <ReviewCard label="滑点占比" value="--" />
        <ReviewCard label="资金周转率" value="--" />
        <ReviewCard label="理论 APY" value="--" />
        <ReviewCard label="账户 APY" value="--" />
        <ReviewCard label="完成笔数" value="0" />
      </div>
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-3 text-purple-400">交易记录</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2">时间</th>
              <th className="text-left py-2">币种</th>
              <th className="text-left py-2">路径</th>
              <th className="text-right py-2">预期净收益</th>
              <th className="text-right py-2">实际净收益</th>
              <th className="text-right py-2">偏差</th>
              <th className="text-center py-2">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-gray-400 text-center">
              <td colSpan={7} className="py-8">暂无交易记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReviewCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="text-xl font-bold text-purple-400">{value}</div>
    </div>
  );
}
