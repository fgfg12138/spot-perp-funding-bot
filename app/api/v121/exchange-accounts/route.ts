import { NextResponse } from "next/server";
import { getRepository } from "@/lib/strategy-v121/persistence/repositoryFactory";
import { ExchangeAccountService } from "@/lib/strategy-v121/exchange-accounts/exchangeAccountService";
import { isMasterKeyConfigured } from "@/lib/strategy-v121/exchange-accounts/masterKey";
import type { CreateExchangeAccountInput } from "@/lib/strategy-v121/exchange-accounts/types";
import type { ExchangeId } from "@/lib/strategy-v121/domain/types";

/**
 * GET /api/v121/exchange-accounts
 * 列出所有已绑定的交易所账户（仅返回脱敏摘要，不含密钥）。
 */
export async function GET() {
  try {
    const service = new ExchangeAccountService(getRepository());
    const accounts = service.listAccounts();
    return NextResponse.json({
      ok: true,
      accounts,
      masterKeyConfigured: isMasterKeyConfigured(),
      count: accounts.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, errors: [err.message ?? String(err)] },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v121/exchange-accounts
 * 创建新的交易所账户绑定（加密保存 API Key/Secret/Passphrase）。
 *
 * Body:
 *   { exchange: "binance"|"okx"|"htx", label: string,
 *     apiKey: string, apiSecret: string, passphrase?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input: CreateExchangeAccountInput = {
      exchange: body.exchange as ExchangeId,
      label: body.label,
      apiKey: body.apiKey,
      apiSecret: body.apiSecret,
      passphrase: body.passphrase,
    };

    const service = new ExchangeAccountService(getRepository());
    const account = await service.createAccount(input);

    return NextResponse.json({ ok: true, account }, { status: 201 });
  } catch (err: any) {
    const message = err.message ?? String(err);
    const status = message.includes("V121_MASTER_KEY") ? 503 : 400;
    return NextResponse.json(
      { ok: false, errors: [message] },
      { status },
    );
  }
}
