import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({
    accepted: true,
    executionId: `paper-${Date.now()}`,
    ...body,
  });
}
