import { NextResponse } from "next/server";
import { getRepository } from "@/lib/strategy-v121/persistence/repositoryFactory";
import { ExchangeAccountService } from "@/lib/strategy-v121/exchange-accounts/exchangeAccountService";
import type { UpdateExchangeAccountInput } from "@/lib/strategy-v121/exchange-accounts/types";

/**
 * GET /api/v121/exchange-accounts/[id]
 * 获取单个账户详情（脱敏摘要 + 能力）。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const service = new ExchangeAccountService(getRepository());
    const account = service.getAccount(id);
    if (!account) {
      return NextResponse.json(
        { ok: false, errors: ["账户不存在"] },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, account });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, errors: [err.message ?? String(err)] },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/v121/exchange-accounts/[id]
 * 更新账户 label 或 enabled 状态（不能修改密钥）。
 *
 * Body: { label?: string, enabled?: boolean }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const input: UpdateExchangeAccountInput = {
      label: body.label,
      enabled: body.enabled,
    };

    const service = new ExchangeAccountService(getRepository());
    const account = service.updateAccount(id, input);

    return NextResponse.json({ ok: true, account });
  } catch (err: any) {
    const message = err.message ?? String(err);
    const status = message.includes("不存在") ? 404 : 400;
    return NextResponse.json(
      { ok: false, errors: [message] },
      { status },
    );
  }
}

/**
 * DELETE /api/v121/exchange-accounts/[id]
 * 删除账户及其能力记录。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const service = new ExchangeAccountService(getRepository());
    service.deleteAccount(id);

    return NextResponse.json({ ok: true, deleted: id });
  } catch (err: any) {
    const message = err.message ?? String(err);
    const status = message.includes("不存在") ? 404 : 500;
    return NextResponse.json(
      { ok: false, errors: [message] },
      { status },
    );
  }
}
