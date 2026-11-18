"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-stone-900/10">
        <div className="bg-ink-950 px-7 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center border border-copper-400/60 font-display text-xl font-bold tracking-wider text-copper-300">
              71
            </div>
            <div className="leading-tight">
              <p className="font-display text-2xl font-semibold uppercase tracking-[0.14em] text-stone-100">
                Highway 71
              </p>
              <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-copper-400">
                Brewing Co. — Ops
              </p>
            </div>
          </div>
        </div>
        <div className="px-7 py-6">
          <h1 className="text-lg font-semibold text-stone-900">Sign in</h1>
          <p className="mt-1 text-sm text-stone-500">
            Enter your email and we'll send you a sign-in link.
          </p>
          {sent ? (
            <p className="mt-4 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
              Check your email for the sign-in link.
            </p>
          ) : (
            <form onSubmit={signIn} className="mt-4 space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@highway71brewing.com"
                className="w-full rounded-lg border border-stone-300 px-3.5 py-3 focus:border-copper-500 focus:outline-none focus:ring-2 focus:ring-copper-500/30"
              />
              <button className="w-full rounded-lg bg-ink-900 py-3 font-semibold text-white transition hover:bg-ink-800">
                Send sign-in link
              </button>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
