"use client";

import { useState } from "react";
import { executeVoiceAction } from "@/lib/actions";
import type { VoiceAction } from "@/app/api/voice/command/route";
import { Mic, Check, Loader2 } from "lucide-react";

type SRWindow = typeof window & {
  webkitSpeechRecognition?: new () => {
    lang: string;
    interimResults: boolean;
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    start: () => void;
  };
  SpeechRecognition?: new () => {
    lang: string;
    interimResults: boolean;
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    start: () => void;
  };
};

/**
 * Voice command bar: transcribes speech, parses it into structured actions,
 * and shows a confirmation card per action. Nothing is written until the
 * user taps Confirm.
 */
export default function VoiceCommandBar() {
  const [state, setState] = useState<"idle" | "listening" | "parsing">("idle");
  const [transcript, setTranscript] = useState("");
  const [actions, setActions] = useState<VoiceAction[]>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const [typed, setTyped] = useState("");

  const srSupported =
    typeof window !== "undefined" &&
    !!((window as unknown as SRWindow).SpeechRecognition ||
      (window as unknown as SRWindow).webkitSpeechRecognition);

  async function parse(text: string) {
    const t = text.trim();
    if (!t) return;
    setState("parsing");
    setError("");
    setTranscript(t);
    try {
      const res = await fetch("/api/voice/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: t }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");
      setActions(data.actions ?? []);
      if ((data.actions ?? []).length === 0) setError("Didn't catch that — try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setState("idle");
    }
  }

  function listen() {
    const w = window as unknown as SRWindow;
    const Rec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Rec) return;
    const rec = new Rec();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const idx = e.results.length - 1;
      parse(e.results[idx][0].transcript);
    };
    rec.onend = () => setState((s) => (s === "listening" ? "idle" : s));
    rec.onerror = () => setState("idle");
    setState("listening");
    try {
      rec.start();
    } catch {
      setState("idle");
    }
  }

  async function confirm(i: number) {
    const action = actions[i];
    setError("");
    try {
      const msg = await executeVoiceAction(action);
      setDone((d) => [...d, msg]);
      setActions((a) => a.filter((_, j) => j !== i));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="rounded-xl bg-ink-950 px-5 py-4 shadow-md">
      <div className="flex items-center gap-4">
        {srSupported ? (
          <button
            onClick={listen}
            disabled={state !== "idle"}
            aria-label="Speak a log entry"
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white transition ${
              state === "listening"
                ? "animate-pulse bg-red-600"
                : "bg-copper-600 hover:bg-copper-500"
            } disabled:opacity-60`}
          >
            {state === "parsing" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Mic className="h-5 w-5" strokeWidth={2} />
            )}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-copper-400">
            {state === "listening" ? "Listening" : state === "parsing" ? "Understanding" : "Voice log"}
          </p>
          <p className="truncate text-sm text-stone-300">
            {transcript
              ? `“${transcript}”`
              : state === "listening"
                ? "Speak now…"
                : 'Say "used one bag of Pilsner" or "kegged four half-barrels of lager"'}
          </p>
          {!srSupported && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                parse(typed);
              }}
            >
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type a log entry…"
                className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder:text-stone-500 focus:border-copper-400 focus:outline-none"
              />
              <button className="rounded-lg bg-copper-600 px-4 py-2 text-sm font-semibold text-white">
                Parse
              </button>
            </form>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300 ring-1 ring-inset ring-red-500/30">{error}</p>
      )}
      {done.map((m, i) => (
        <p key={i} className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-950/60 px-3 py-2 text-sm text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
          <Check className="h-4 w-4 shrink-0" /> {m}
        </p>
      ))}

      {actions.map((a, i) => (
        <div
          key={i}
          className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3.5 py-2.5 ring-1 ring-inset ring-copper-400/40"
        >
          <p className="text-sm font-medium text-stone-100">{a.summary}</p>
          <button
            onClick={() => confirm(i)}
            className="shrink-0 rounded-md bg-copper-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-copper-500"
          >
            Confirm
          </button>
        </div>
      ))}
    </div>
  );
}
