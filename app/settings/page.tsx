export const instant = false;
import { createClient } from "@/lib/supabase/server";
import { checkConnection, streamConfigured } from "@/lib/brewfather";
import SyncButton from "@/components/SyncButton";
import SignOutButton from "@/components/SignOutButton";
import { PageHeader, Card } from "@/components/ui";

function Row({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-stone-800">{label}</p>
        {hint && <p className="text-xs text-stone-400">{hint}</p>}
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset ${
          ok
            ? "bg-emerald-50 text-emerald-700 ring-emerald-600/25"
            : "bg-stone-100 text-stone-500 ring-stone-500/20"
        }`}
      >
        {ok ? "On" : "Off"}
      </span>
    </li>
  );
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let bf: { ok: boolean; detail: string } = { ok: false, detail: "Not configured" };
  if (process.env.BREWFATHER_USER_ID && process.env.BREWFATHER_API_KEY) {
    try {
      bf = await checkConnection();
    } catch (e) {
      bf = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="System" title="Settings" />

      <div className="space-y-4">
        <Card title="Brewfather integration">
          <p className={`text-sm ${bf.ok ? "text-emerald-700" : "text-red-600"}`}>
            {bf.ok
              ? "Connected. Batches sync automatically every 15 minutes."
              : bf.detail}
          </p>
          <div className="mt-3">
            <SyncButton />
          </div>
          <p className="mt-3 text-xs text-stone-400">
            Key is generated in the Brewfather app under Settings → API (Premium), with all five scopes enabled.
          </p>
        </Card>

        <Card title="Configuration">
          <ul className="-my-2 divide-y divide-stone-100">
            <Row label="Database (Supabase)" ok={!!process.env.NEXT_PUBLIC_SUPABASE_URL} />
            <Row label="Brewfather credentials" ok={!!(process.env.BREWFATHER_USER_ID && process.env.BREWFATHER_API_KEY)} />
            <Row label="Voice commands (AI parsing)" ok={!!process.env.OPENAI_API_KEY} hint="Dictation works without this" />
            <Row label="Scheduled sync secret" ok={!!process.env.CRON_SECRET} />
            <Row label="Push batch status to Brewfather" ok={process.env.PUSH_TO_BREWFATHER === "true"} />
            <Row
              label="Send fermentation readings to Brewfather"
              ok={streamConfigured()}
              hint="Brewfather → Settings → Power-ups → Custom Stream: copy the logging URL into BREWFATHER_STREAM_URL"
            />
          </ul>
        </Card>

        <Card title="Account">
          <p className="text-sm text-stone-500">
            {user?.email ?? "Sign-in is temporarily disabled — the app is open to anyone with the link."}
          </p>
          {user && (
            <div className="mt-3">
              <SignOutButton />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
