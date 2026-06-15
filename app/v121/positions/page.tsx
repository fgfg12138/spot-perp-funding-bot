export default function PositionsPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">持仓监控</h2>
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2">币种</th>
              <th className="text-left py-2">路径</th>
              <th className="text-right py-2">当前基差</th>
              <th className="text-right py-2">平仓基差</th>
              <th className="text-right py-2">Mark</th>
              <th className="text-right py-2">funding</th>
              <th className="text-right py-2">已收资金费</th>
              <th className="text-right py-2">PnL</th>
              <th className="text-center py-2">ADL</th>
              <th className="text-center py-2">持仓时长</th>
              <th className="text-center py-2">建议</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-gray-400 text-center">
              <td colSpan={11} className="py-8">暂无持仓</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
