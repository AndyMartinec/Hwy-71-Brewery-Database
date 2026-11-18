import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AUTH_DISABLED } from "@/lib/config";

// Voice-command parser: turns a spoken transcript into structured,
// confirmable actions. NEVER executes — the client shows each action as a
// confirmation card and only then calls the matching server action.

export interface VoiceAction {
  type:
    | "use_ingredient"
    | "receive_ingredient"
    | "log_reading"
    | "package_beer"
    | "move_beer"
    | "unknown";
  ingredient?: string;
  qty?: number;
  unit?: string;
  batch?: string;
  beer?: string;
  package_type?: string;
  gravity?: number;
  temp_f?: number;
  channel?: string;
  reason?: string;
  note?: string;
  summary: string;
}

const SYSTEM_PROMPT = `You are a brewery-operations parser for Highway 71 Brewing. Convert the brewer's spoken log entry into JSON actions.

Respond with ONLY a JSON object: {"actions": [ ... ]} where each action is:
- {"type":"use_ingredient","ingredient":"<name>","qty":<number>,"unit":"lb","batch":"<batch name if mentioned>","summary":"<plain-English summary>"}
- {"type":"receive_ingredient","ingredient":"<name>","qty":<number>,"unit":"lb","summary":"..."}
- {"type":"log_reading","batch":"<batch name>","gravity":<e.g. 1.052 or null>,"temp_f":<number or null>,"note":"<...>","summary":"..."}
- {"type":"package_beer","beer":"<beer name>","package_type":"Half-barrel keg","qty":<number>,"summary":"..."}
- {"type":"move_beer","beer":"<beer name>","package_type":"Half-barrel keg","qty":<negative number for out>,"reason":"sold|destroyed|adjustment|returned","channel":"retail|on_premise|off_premise|distributor or null","summary":"..."}
- {"type":"unknown","summary":"<what you think they meant, and ask for clarification>"}

Rules:
- Match ingredient/beer/batch names to the KNOWN lists below using closest spelling (voice transcription is messy). Never invent new names; if nothing matches, use type "unknown".
- Quantities: "a bag" of grain = 55 lb unless the known package says otherwise. "a keg" out = one package.
- Gravity may be spoken as "ten fifty-two" meaning 1.052, or "one point zero five two".
- Default package_type is "Half-barrel keg" for keg moves.
- Keep summaries short, e.g. "Use 55 lb IREKS Pilsner Malt".
- If the transcript contains multiple distinct operations, return one action per operation.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user && !AUTH_DISABLED) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice commands need OPENAI_API_KEY configured. Dictation still works without it." },
      { status: 503 }
    );
  }

  const { transcript } = (await request.json()) as { transcript?: string };
  if (!transcript?.trim()) {
    return NextResponse.json({ error: "Empty transcript" }, { status: 400 });
  }

  // Ground the model in the real inventory so it matches names correctly.
  const [{ data: ingredients }, { data: batches }, { data: stock }] = await Promise.all([
    supabase.from("ingredients").select("name,unit").order("name"),
    supabase.from("batches").select("recipe_name,batch_number").order("updated_at", { ascending: false }).limit(20),
    supabase.from("finished_stock").select("beer_name,package_type"),
  ]);

  const context = [
    `KNOWN INGREDIENTS: ${(ingredients ?? []).map((i) => `${i.name} (${i.unit})`).join("; ") || "none"}`,
    `KNOWN BATCHES: ${(batches ?? []).map((b) => b.batch_number ? `${b.recipe_name} (#${b.batch_number})` : b.recipe_name).join("; ") || "none"}`,
    `KNOWN BEERS: ${[...new Set((stock ?? []).map((s) => s.beer_name))].join("; ") || "none"}`,
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${context}\n\nTRANSCRIPT: "${transcript}"` },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Transcription service error: ${body.slice(0, 200)}` },
      { status: 502 }
    );
  }

  const data = await res.json();
  try {
    const parsed = JSON.parse(data.choices[0].message.content) as {
      actions: VoiceAction[];
    };
    return NextResponse.json({ actions: parsed.actions ?? [] });
  } catch {
    return NextResponse.json(
      { error: "Could not parse that — try again with simpler wording." },
      { status: 502 }
    );
  }
}
