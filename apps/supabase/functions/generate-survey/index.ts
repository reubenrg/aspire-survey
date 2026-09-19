// Aspire Surveys - generate-survey Edge Function
//
// Drafts a survey from a plain-language description using the Anthropic API.
// The model is only a drafting aid: the browser rebuilds whatever comes back
// from a whitelist (engine/aiDefinition.ts) and runs the normal structural
// validation before anything can be created or published.
//
// Access: verify_jwt is on, and the caller must additionally hold the editor
// (or owner) role in some workspace - checked with the caller's own JWT so the
// database's role rules apply, not this function's opinion. Limited to 20
// drafts per person per hour (ai_generation_log). Requires the Edge Function
// secret ANTHROPIC_API_KEY; without it the function answers 503
// AI_NOT_CONFIGURED and the app says so plainly.
//
// Nothing about respondents ever reaches the model: only the author's prompt.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";
const PER_HOUR = 20;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const SYSTEM = `You design survey questionnaires for a survey platform. Reply with ONE JSON object and nothing else - no prose, no code fences.

Shape:
{
  "title": string,
  "welcome": { "heading": string, "body": string[] },
  "thankYou": { "heading": string, "body": string },
  "sections": [ { "id": snake_case, "title": string, "intro"?: string, "questions": [ Question ] } ]
}

Question = { "id": snake_case (unique across the survey), "type": one of the types below, "label": the question text, "required"?: boolean, "hint"?: string, ...type fields }

Types and their fields:
- "text" (one line), "textarea" (paragraph): optional "placeholder", "minLength", "maxLength".
- "radio" (single choice), "select" (dropdown), "checkbox" (multiple choice, optional "maxSelections"), "ranking": "options": string[] with 2 to 12 entries; optional "randomize": true to shuffle.
- "yesno": optional "yesLabel", "noLabel".
- "rating": "max" 3 to 10 (default 5), "shape": "star" or "number", optional "lowLabel"/"highLabel".
- "nps": the 0-10 recommend question, optional "lowLabel"/"highLabel".
- "slider": "min", "max", "step", optional "unit", "lowLabel", "highLabel".
- "number": optional "min", "max", "integer": true, "unit".
- "date".
- "matrix": "rows": string[] (statements), "scale": string[] (2 to 7 labels, e.g. Strongly disagree ... Strongly agree).
- "sum": "rows": string[] (items), "total": number (default 100) - the respondent splits the total across the items.
- "heading": a title ("label") and optional paragraph ("hint"); collects no answer.

Guidance: 8 to 25 questions in 1 to 5 sections, ordered from easy and general to specific and sensitive. One idea per question; neutral, unbiased wording; balanced answer choices with an "Other" or "Not applicable" option where a list may be incomplete. Prefer rating, nps, matrix and choice questions over free text; keep free text to 1 or 2 questions. Make questions required only when the survey cannot be interpreted without them. Never ask for names, email addresses, phone numbers or other personal identifiers unless the request explicitly demands it. Write in the language of the request. If the request is not about creating a survey, still return a small, sensible survey on the closest topic.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const email = userData?.user?.email;
  if (userErr || !email) return json({ error: "NOT_SIGNED_IN" }, 401);

  const { data: isEditor, error: roleErr } = await userClient.rpc("is_survey_editor_anywhere");
  if (roleErr || isEditor !== true) return json({ error: "NOT_AUTHORISED" }, 403);

  if (!ANTHROPIC_API_KEY) return json({ error: "AI_NOT_CONFIGURED" }, 503);

  let body: { prompt?: unknown };
  try { body = await req.json(); } catch { return json({ error: "BAD_REQUEST" }, 400); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 10) return json({ error: "PROMPT_TOO_SHORT" }, 400);
  if (prompt.length > 2000) return json({ error: "PROMPT_TOO_LONG" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await admin.from("ai_generation_log").select("id", { count: "exact", head: true })
    .eq("user_email", email).gte("created_at", since);
  if ((count ?? 0) >= PER_HOUR) return json({ error: "RATE_LIMITED" }, 429);
  await admin.from("ai_generation_log").insert({ user_email: email, prompt_chars: prompt.length });

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
    });
  } catch {
    console.log(JSON.stringify({ event: "ai_generate_failed", reason: "network" }));
    return json({ error: "AI_UNAVAILABLE" }, 502);
  }
  if (!res.ok) {
    console.log(JSON.stringify({ event: "ai_generate_failed", status: res.status }));
    return json({ error: res.status === 401 ? "AI_KEY_REJECTED" : "AI_UNAVAILABLE" }, 502);
  }
  const data = await res.json();
  const text = Array.isArray(data?.content) ? data.content.map((c: { text?: string }) => c.text ?? "").join("") : "";
  console.log(JSON.stringify({ event: "ai_generate_ok", ms: Date.now() - started, out_chars: text.length }));
  // The browser parses and sanitises this; the raw text is returned so nothing is lost or reinterpreted here.
  return json({ text });
});
