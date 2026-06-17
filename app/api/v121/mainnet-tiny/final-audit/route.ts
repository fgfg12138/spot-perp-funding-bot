import { NextResponse } from "next/server";
import { runFinalPreExecutionAudit } from "@/lib/strategy-v121/mainnetTiny/finalPreExecutionAudit";

export async function GET() {
  const result = await runFinalPreExecutionAudit();
  return NextResponse.json({
    ...result,
    _note: "当前不会真实下单。系统只是在评估是否具备申请 10U 手动验证的条件。",
  });
}
