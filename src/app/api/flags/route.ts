import { NextResponse } from "next/server";
import { getFlags } from "@/lib/panel.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const flags = await getFlags();
    return NextResponse.json({ flags });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
