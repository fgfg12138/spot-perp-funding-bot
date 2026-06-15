import { NextResponse } from "next/server";
import { getDashboardStatus } from "@/lib/strategy-v121/api/dashboardService";

export async function GET() {
  const status = getDashboardStatus("READ_ONLY");
  return NextResponse.json(status);
}
