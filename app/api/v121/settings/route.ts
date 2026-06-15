import { NextResponse } from "next/server";
import { getConfig, updateConfig } from "@/lib/strategy-v121/config/strategyConfig";

export async function GET() {
  return NextResponse.json(getConfig());
}

export async function PUT(request: Request) {
  const body = await request.json();
  const updated = updateConfig(body);
  return NextResponse.json(updated);
}
