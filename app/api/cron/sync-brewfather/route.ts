import { NextResponse } from "next/server";
import { syncFromBrewfather } from "@/lib/sync";

// Called by the scheduled job (GitHub Actions) every 15 minutes.
// Protect with CRON_SECRET so only the scheduler can trigger it.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided =
    request.headers.get("x-cron-secret") ??
    new URL(request.url).searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncFromBrewfather();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
