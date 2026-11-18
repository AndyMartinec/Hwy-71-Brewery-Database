"use client";

import { useState } from "react";
import { Mic } from "lucide-react";

type SR = typeof window extends never
  ? never
  : (typeof window & {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      SpeechRecognition?: new () => SpeechRecognitionLike;
    });

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

/** Mic button that appends dictated text to a field via the Web Speech API (free, on-device). */
export default function VoiceDictation({
  onText,
}: {
  onText: (text: string) => void;
}) {
  const [listening, setListening] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    !!((window as unknown as SR).SpeechRecognition ||
      (window as unknown as SR).webkitSpeechRecognition);

  if (!supported) return null;

  function toggle() {
    if (listening) return;
    const w = window as unknown as SR;
    const Rec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Rec) return;
    const rec: SpeechRecognitionLike = new Rec();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const last = e.results[Object.keys(e.results).length - 1];
      const text = last[0].transcript.trim();
      if (text) onText(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Dictate"
      aria-label="Dictate text"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition ${
        listening
          ? "animate-pulse border-red-300 bg-red-50 text-red-600"
          : "border-stone-300 bg-white text-stone-500 hover:border-copper-400 hover:text-copper-700"
      }`}
    >
      <Mic className="h-4.5 w-4.5" strokeWidth={2} />
    </button>
  );
}
