import { NextRequest, NextResponse } from "next/server";
import { findClosePlanById } from "@/lib/strategy-v121/position/closePlanLedger";
import { createAccountAdapter } from "@/lib/strategy-v121/account/adapters/accountAdapterFactory";

/**
 * POST /api/v121/mainnet-tiny/close-plan/test
 *
 * 交易所参数校验：对已生成的平仓方案做 exchange-side 参数检查。
 * 不下单，只校验方案在交易所侧是否可执行（minQty/stepSize/minNotional/权限）。
 *
 * 镜像 order-plan/test 的模式：加载方案 → 阻断级校验 → adapter.validateOrderPlan。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const plan = await findClosePlanById(body.closePlanId);

    if (!plan) {
      return NextResponse.json(
        { ok: false, status: "blocked", blockers: ["close plan not found"], warnings: [] },
        { status: 404 },
      );
    }

    if (plan.status !== "validated") {
      return NextResponse.json({
        ok: false,
        status: "blocked",
        blockers: [`平仓方案状态为 ${plan.status}，仅校验通过的方案可执行参数校验`],
        warnings: [],
        closePlanId: plan.id,
      });
    }

    if (!plan.spotLeg || !plan.perpLeg) {
      return NextResponse.json({
        ok: false,
        status: "blocked",
        blockers: ["平仓方案缺少腿定义"],
        warnings: [],
        closePlanId: plan.id,
      });
    }

    const { adapter } = createAccountAdapter(plan.exchange);
    if (!adapter.validateOrderPlan) {
      // 无 validateOrderPlan 时，回退到基本数量校验
      const blockers: string[] = [];
      if (plan.spotLeg.quantity <= 0) blockers.push("现货平仓数量须大于 0");
      if (plan.perpLeg.quantity <= 0) blockers.push("合约平仓数量须大于 0");
      return NextResponse.json({
        ok: blockers.length === 0,
        status: blockers.length === 0 ? "validated" : "blocked",
        blockers,
        warnings: ["adapter 未实现 validateOrderPlan，仅做基本数量校验"],
        closePlanId: plan.id,
      });
    }

    // 复用 adapter.validateOrderPlan：它校验 spotLeg/perpLeg 的 minQty/stepSize/minNotional。
    // 平仓腿的 role 是 spot_sell/perp_buy_close，但数量/约束结构与开仓腿一致，可直接校验。
    // 构造一个 TwoLegOrderPlan 形状的对象传给 validateOrderPlan。
    const fakePlan = {
      id: plan.id,
      status: "validated",
      exchange: plan.exchange,
      symbol: plan.symbol,
      plannedNotionalUsdt: Math.max(plan.spotLeg.quoteNotionalUsdt, plan.perpLeg.quoteNotionalUsdt),
      spotLeg: plan.spotLeg,
      perpLeg: plan.perpLeg,
      blockers: [],
      warnings: [],
      createdAtUtc: plan.createdAtUtc,
      expiresAtUtc: plan.expiresAtUtc,
      allowedForActualOrder: false,
    } as any;

    const result = await adapter.validateOrderPlan(fakePlan);
    return NextResponse.json({
      ok: result.ok,
      status: result.ok ? "validated" : "blocked",
      blockers: result.blockers,
      warnings: result.warnings,
      closePlanId: plan.id,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, status: "failed", error: err.message, blockers: [err.message], warnings: [] },
      { status: 500 },
    );
  }
}
