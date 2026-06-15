import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ reviews: [], total: 0 });
}
