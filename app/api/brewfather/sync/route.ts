import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncFromBrewfather } from "@/lib/sync";
import { AUTH_DISABLED } from "@/lib/config";

// Manual "Sync now" button (Settings page). Requires a signed-in user.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user && !AUTH_DISABLED) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
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
