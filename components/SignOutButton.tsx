"use client";

import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  return (
    <button
      onClick={async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        window.location.href = "/login";
      }}
      className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold"
    >
      Sign out
    </button>
  );
}
