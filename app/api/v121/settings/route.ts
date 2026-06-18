import { NextResponse } from "next/server";
import { loadSettings, saveSettingsPatch } from "@/lib/strategy-v121/settings/userStrategySettingsStore";

export async function GET() {
  const settings = await loadSettings();
  return NextResponse.json({ ok: true, settings });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { settings, warnings } = await saveSettingsPatch(body);
    if (warnings.length > 0) {
      return NextResponse.json({ ok: false, errors: warnings }, { status: 400 });
    }
    return NextResponse.json({ ok: true, settings, warnings });
  } catch (err: any) {
    return NextResponse.json({ ok: false, errors: [err.message ?? String(err)] }, { status: 500 });
  }
}
