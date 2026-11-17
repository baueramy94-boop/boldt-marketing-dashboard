import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Recommendations tab: shared complete / delete state for every recommendation, and "Add to tracker".
// State lives in Netlify Blobs store "recs" (key "state"): { "<rec id>": { done?, deleted?, tracker?, by, at } }
// GET  /api/recs                                   -> { ok, state }
// POST /api/recs { id, action: done|undone|delete|restore }            -> { ok, state }
// POST /api/recs { id, action: tracker, title, detail, owner?, ws?, source } -> creates a project in the tracker Sheet
//   (same Apps Script as /api/tracker), then { ok, state, itemId }
// Rec ids are made in the page from the source and the text, so the same recommendation keeps its state.
// The edge gate has already checked the site password.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ID = /^[a-z0-9-]{4,60}$/i;
const OWNERS = new Set(["Amy", "Leslie", "Pivot Design", "Core Task Force", "Admin", "Boldt IT", "Project team", "Corporate Marketing", "Heidi", "Jake", "Alex", "Chris"]);
const cut = (v: any, n: number) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "recs", consistency: "strong" });
  try {
    const state: Record<string, any> = (await store.get("state", { type: "json" })) || {};
    if (req.method === "GET") return json({ ok: true, state });
    if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
    const b: any = await req.json().catch(() => ({}));
    const id = String(b.id || ""), action = String(b.action || "");
    if (!ID.test(id)) return json({ ok: false, error: "bad request" }, 400);
    const user = decodeURIComponent(context.cookies.get("bmd_user") || "") || "someone";
    const now = new Date().toISOString();
    const cur = state[id] || {};
    let itemId = "";
    if (action === "done") state[id] = { ...cur, done: true, doneBy: user, doneAt: now };
    else if (action === "undone") { const { done, doneBy, doneAt, ...rest } = cur; state[id] = rest; }
    else if (action === "delete") state[id] = { ...cur, deleted: true, deletedBy: user, deletedAt: now };
    else if (action === "restore") { const { deleted, deletedBy, deletedAt, ...rest } = cur; state[id] = rest; }
    else if (action === "tracker") {
      if (cur.tracker) return json({ ok: true, state, itemId: cur.tracker.itemId });
      const base = Netlify.env.get("SCRIPT_URL"), token = Netlify.env.get("SCRIPT_TOKEN");
      if (!base || !token) return json({ ok: false, error: "The project tracker isn't connected." }, 503);
      const title = cut(b.title, 200);
      if (!title) return json({ ok: false, error: "bad request" }, 400);
      itemId = "r" + id.replace(/[^a-z0-9]/gi, "").slice(0, 20);
      const owners = String(b.owner || "").split(/[,/]| and /).map((x) => x.trim()).filter((x) => OWNERS.has(x)).slice(0, 4);
      const notes = [cut(b.detail, 1500), `From the dashboard Recommendations tab (${cut(b.source, 120) || "recommendation"}), added by ${user} on ${now.slice(0, 10)}.`].filter(Boolean).join("\n\n");
      const item = { id: itemId, title, ws: cut(b.ws, 40) || "Operations", owners: owners.length ? owners : ["Amy"], due: null, prec: null, status: "Not started", notes, waiting: "", src: "Dashboard recommendation", subtasks: [], board: "marketing" };
      const r = await fetch(base, { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, redirect: "follow",
        body: JSON.stringify({ token, user, upserts: { items: [item] }, deletes: {} }) });
      const j: any = await r.json().catch(() => ({}));
      if (!j.ok) return json({ ok: false, error: "The tracker didn't accept the project. Try again in a minute." }, 502);
      // Same as a save from the tracker page: drop the cached calendar and never serve one older than this save.
      try { const tc = getStore({ name: "tracker-cache", consistency: "strong" }); await tc.delete("latest"); if (j.savedAt) await tc.setJSON("floor", { lastSave: String(j.savedAt) }); } catch {}
      state[id] = { ...cur, tracker: { itemId, by: user, at: now } };
    } else return json({ ok: false, error: "bad request" }, 400);
    if (!Object.keys(state[id] || {}).length) delete state[id];
    await store.setJSON("state", state);
    return json({ ok: true, state, itemId });
  } catch {
    return json({ ok: false, error: "storage unavailable" }, 502);
  }
};

export const config: Config = { path: "/api/recs", method: ["GET", "POST"] };
