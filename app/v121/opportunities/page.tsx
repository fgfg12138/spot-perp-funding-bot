export default function OpportunitiesPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">机会池</h2>
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <p className="text-gray-400 mb-4">只显示正 funding 期现路径 (Binance / OKX / HTX)</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2">币种</th>
              <th className="text-left py-2">现货</th>
              <th className="text-left py-2">合约</th>
              <th className="text-right py-2">funding_8h</th>
              <th className="text-right py-2">开仓基差</th>
              <th className="text-right py-2">净收益率</th>
              <th className="text-right py-2">评分</th>
              <th className="text-center py-2">等级</th>
              <th className="text-center py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-gray-400 text-center">
              <td colSpan={9} className="py-8">暂无机会数据（需接入行情）</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
