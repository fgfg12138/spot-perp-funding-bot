import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    opportunities: [],
    total: 0,
    timestamp: Date.now(),
  });
}
