import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Saved text edits for the dashboard narratives, one JSON record per report month:
// { "<path into the month's data>": { v: "<new text>", by: "<user>", at: "<ISO time>" } }
// The edge gate has already checked the site password.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const MONTH = /^\d{4}-\d{2}$/;
const PATH = /^[A-Za-z0-9_.]{1,120}$/;

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "dashboard-edits", consistency: "strong" });
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const m = url.searchParams.get("month") || "";
      if (!MONTH.test(m)) return json({ ok: false, error: "month must be YYYY-MM" }, 400);
      const e = (await store.get(m, { type: "json" })) || {};
      return json({ ok: true, month: m, edits: e });
    }
    if (req.method === "POST") {
      const body = await req.json();
      const m = String(body.month || "");
      if (!MONTH.test(m)) return json({ ok: false, error: "month must be YYYY-MM" }, 400);
      const changes = Array.isArray(body.changes) ? body.changes.slice(0, 50) : [];
      const user = decodeURIComponent(context.cookies.get("bmd_user") || "") || "someone";
      const e: Record<string, any> = (await store.get(m, { type: "json" })) || {};
      const now = new Date().toISOString();
      for (const c of changes) {
        const p = String(c.path || "");
        if (!PATH.test(p)) continue;
        if (c.reset) { delete e[p]; continue; }
        const v = String(c.value ?? "").slice(0, 6000);
        e[p] = { v, by: user, at: now };
      }
      await store.setJSON(m, e);
      return json({ ok: true, month: m, edits: e });
    }
    return json({ ok: false, error: "method not allowed" }, 405);
  } catch (err) {
    return json({ ok: false, error: "storage unavailable" }, 502);
  }
};

export const config: Config = { path: "/api/edits", method: ["GET", "POST"] };
