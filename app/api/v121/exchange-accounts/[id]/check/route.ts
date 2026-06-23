import { NextResponse } from "next/server";
import { getRepository } from "@/lib/strategy-v121/persistence/repositoryFactory";
import { ExchangeAccountService } from "@/lib/strategy-v121/exchange-accounts/exchangeAccountService";

/**
 * POST /api/v121/exchange-accounts/[id]/check
 * 对账户执行只读权限探测，更新并返回能力记录。
 *
 * 仅调用读取接口（fetchBalances / fetchPositions / fetchOpenOrders / healthCheck），
 * 不修改账户状态。
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const service = new ExchangeAccountService(getRepository());
    const report = await service.probeAccount(id);

    return NextResponse.json({
      ok: true,
      accountId: id,
      probes: report.probes,
      capability: report.capability,
      timestampUtc: report.timestampUtc,
    });
  } catch (err: any) {
    const message = err.message ?? String(err);
    const status = message.includes("不存在") ? 404 : 500;
    return NextResponse.json(
      { ok: false, errors: [message] },
      { status },
    );
  }
}
