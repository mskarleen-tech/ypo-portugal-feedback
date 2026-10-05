// Stores and returns Portugal retreat feedback in the Redis database Vercel connects to this project.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "portugal-2027-feedback";
const KINDS = ["question", "comment", "remark", "offer"];
const PARTS = ["focus", "win", "challenge", "ask"];

async function redis(...cmd) {
  const r = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error("database error " + r.status);
  return (await r.json()).result;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) return res.status(500).json({ error: "Database not connected yet" });
  try {
    if (req.method === "GET") {
      const rows = await redis("LRANGE", KEY, 0, 4999);
      return res.status(200).json(rows.map(r => JSON.parse(r)));
    }
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const text = String(b.text || "").trim().slice(0, 2000);
      const network = String(b.network || "").slice(0, 20);
      if (!text || !/^[a-z]+$/.test(network)) return res.status(400).json({ error: "Missing network or feedback text" });
      const rec = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        network,
        room: Number(b.room) || null,
        kind: KINDS.includes(b.kind) ? b.kind : "comment",
        part: PARTS.includes(b.part) ? b.part : null,
        text,
        name: b.name ? String(b.name).trim().slice(0, 80) : null,
        at: Date.now(),
      };
      await redis("LPUSH", KEY, JSON.stringify(rec));
      return res.status(200).json(rec);
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: "Could not reach the feedback database" });
  }
}
