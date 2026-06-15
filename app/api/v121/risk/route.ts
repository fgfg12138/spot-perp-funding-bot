import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ health: "ok", freezeLevel: "none", decisions: [] });
}
