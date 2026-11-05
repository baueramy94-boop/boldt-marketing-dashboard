import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Companies removed from the MQL counts by hand (anomalies). One shared list for every report month:
// { "<root domain>": { name, by, at } }
// GET  /api/exclusions                      -> { ok, list }
// POST /api/exclusions { domain, name, exclude: true|false } -> { ok, list }
// The edge gate has already checked the site password.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const DOMAIN = /^[a-z0-9.-]{3,120}$/;

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "dashboard-exclusions", consistency: "strong" });
  try {
    const list: Record<string, any> = (await store.get("mql", { type: "json" })) || {};
    if (req.method === "GET") return json({ ok: true, list });
    if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
    const b: any = await req.json().catch(() => ({}));
    const d = String(b.domain || "").toLowerCase();
    if (!DOMAIN.test(d)) return json({ ok: false, error: "bad request" }, 400);
    if (b.exclude) {
      const user = decodeURIComponent(context.cookies.get("bmd_user") || "") || "someone";
      list[d] = { name: String(b.name || d).slice(0, 160), by: user, at: new Date().toISOString() };
    } else delete list[d];
    await store.setJSON("mql", list);
    return json({ ok: true, list });
  } catch {
    return json({ ok: false, error: "storage unavailable" }, 502);
  }
};

export const config: Config = { path: "/api/exclusions", method: ["GET", "POST"] };
