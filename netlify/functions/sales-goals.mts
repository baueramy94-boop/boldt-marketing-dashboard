import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Monthly goals by sales rep for the Sales Dashboard's Goals page.
// One record: { "<YYYY-MM>": { "<owner id>": { calls, emails, held, tasksDone } }, _log: { "<YYYY-MM>": { by, at } } }
// GET  /api/sales-goals -> { ok, goals }
// POST /api/sales-goals { month, rep, metric, value }  (value null or "" clears the goal) -> { ok, goals }
// A month without goals uses the most recent earlier month that has them (the page handles that).
// The edge gate has already checked the site password.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const MONTH = /^\d{4}-\d{2}$/, REP = /^\d{1,20}$/;
const METRICS = new Set(["calls", "emails", "held", "tasksDone"]);

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "sales-goals", consistency: "strong" });
  try {
    const g: Record<string, any> = (await store.get("goals", { type: "json" })) || {};
    if (req.method === "GET") return json({ ok: true, goals: g });
    if (req.method === "POST") {
      const b: any = await req.json();
      const m = String(b.month || ""), rep = String(b.rep || ""), k = String(b.metric || "");
      if (!MONTH.test(m) || !REP.test(rep) || !METRICS.has(k)) return json({ ok: false, error: "bad request" }, 400);
      const clear = b.value === null || b.value === "", v = Math.round(Number(b.value));
      if (!clear && !(v >= 0 && v <= 100000)) return json({ ok: false, error: "goal must be a number from 0 to 100,000" }, 400);
      g[m] = g[m] || {}; g[m][rep] = g[m][rep] || {};
      if (clear) delete g[m][rep][k]; else g[m][rep][k] = v;
      if (!Object.keys(g[m][rep]).length) delete g[m][rep];
      if (!Object.keys(g[m]).length) delete g[m];
      g._log = g._log || {}; g._log[m] = { by: decodeURIComponent(context.cookies.get("bmd_user") || "") || "someone", at: new Date().toISOString() };
      await store.setJSON("goals", g);
      return json({ ok: true, goals: g });
    }
    return json({ ok: false, error: "method not allowed" }, 405);
  } catch (err) {
    return json({ ok: false, error: "storage unavailable" }, 502);
  }
};

export const config: Config = { path: "/api/sales-goals", method: ["GET", "POST"] };
