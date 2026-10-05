// Writes an AI summary of the Portugal retreat feedback for one room, the Main Room, or the whole retreat.
// Needs ANTHROPIC_API_KEY in the Vercel project's environment variables.
import Anthropic from "@anthropic-ai/sdk";

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "portugal-2027-feedback";
const SCOPES = {
  "room-1": "Room 1", "room-2": "Room 2", "room-3": "Room 3", "room-4": "Room 4",
  main: "Main Room", all: "Whole retreat",
};
const LABELS = { question: "Question", comment: "Comment", remark: "Remark", offer: "Offer to help" };

async function redis(...cmd) {
  const r = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error("database error " + r.status);
  return (await r.json()).result;
}

const SYSTEM = `You summarise audience feedback from YPO's network strategy session at the January 2027 Portugal retreat.
Each network gave a four-minute pitch: Focus (where they are going), Win (what they are building on), Challenge (what could inhibit progress) and Ask (where the room could help).
Audiences left questions, comments, remarks and offers to help, optionally tagged with the part of the pitch. Main Room notes are remarks on the whole session.

Write for network directors and the strategy team, in plain British English, about 250-400 words:
1. One short opening paragraph with the overall picture.
2. "Common themes" across networks.
3. "Standout strengths" and "Recurring challenges".
4. "Offers and connections" people put forward, naming the networks they were for.
5. "Suggested next steps", three at most.
Use the network names given. Quote only short phrases. Do not invent anything that is not in the notes. Use plain paragraphs and short headed sections separated by blank lines, with no markdown symbols.`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "AI summaries aren't switched on yet. The organiser needs to add the AI key in Vercel." });
  if (!URL_ || !TOKEN) return res.status(500).json({ error: "Database not connected yet" });

  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const scope = SCOPES[b.scope] ? b.scope : "all";
  try {
    const all = (await redis("LRANGE", KEY, 0, 4999)).map(r => JSON.parse(r));
    const rows = all.filter(e =>
      scope === "all" ? true :
      scope === "main" ? e.network === "main" :
      e.network !== "main" && String(e.room) === scope.slice(5));
    if (!rows.length) return res.status(200).json({ title: SCOPES[scope], count: 0, summary: "There's no feedback here yet." });

    // Reuse the last summary while no new feedback has arrived, so repeat clicks cost nothing.
    const cacheKey = `portugal-2027-summary:${scope}`;
    const cached = await redis("GET", cacheKey);
    if (cached) {
      const c = JSON.parse(cached);
      if (c.count === rows.length) return res.status(200).json({ ...c, cached: true });
    }

    const names = b.names && typeof b.names === "object" ? b.names : {};
    const notes = rows.map(e => `- [${names[e.network] || e.network}${e.room ? `, Room ${e.room}` : ""}] ${LABELS[e.kind] || "Note"}${e.part ? ` on the ${e.part}` : ""}: ${e.text}`).join("\n");

    const client = new Anthropic();
    const params = {
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Summarise this feedback for: ${SCOPES[scope]}.\n\n${notes}` }],
    };
    let msg;
    try {
      // Server-side fallback lets another model finish if a safety check declines the request.
      msg = await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) msg = await client.messages.create(params);
      else throw e;
    }
    if (msg.stop_reason === "refusal") return res.status(422).json({ error: "The AI declined to summarise this feedback." });
    const summary = msg.content.filter(c => c.type === "text").map(c => c.text).join("\n").trim();
    const out = { title: SCOPES[scope], count: rows.length, summary, at: Date.now() };
    await redis("SET", cacheKey, JSON.stringify(out));
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: "The AI key in Vercel isn't valid. Check ANTHROPIC_API_KEY." });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "The AI is busy. Try again in a minute." });
    return res.status(500).json({ error: "The summary couldn't be created. Try again in a minute." });
  }
}
