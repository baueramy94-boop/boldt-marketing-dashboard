import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Campaign Builder: shared review state for a campaign's ads, so every edit, approval, note and removal
// saves for everyone who opens the page.
// Netlify Blobs store "campaigns". One key per ad so two people working on different ads never overwrite each other:
//   c/<campaign>/i/<ad id>  -> { status, note, edits, edited, removed, by, at, atFull, savedBy, savedAt }
//   c/<campaign>/bg         -> { bg, by, at }   (white | navy | black background for the sketch, photo and text ads)
// GET  /api/campaigns?c=<campaign>                      -> { ok, state: { bg, items }, now }
// POST /api/campaigns { c, op: "item", id, item }       -> saves one ad's review
// POST /api/campaigns { c, op: "items", items: {id: item} } -> saves several (used by Remove this set)
// POST /api/campaigns { c, op: "bg", bg }               -> saves the background choice
// POST /api/campaigns { c, op: "reset" }                -> clears edits, approvals and notes; removed ads stay removed
// The edge gate has already checked the site password.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const CAMP = /^[a-z0-9-]{2,40}$/;
const ID = /^[A-Za-z0-9_-]{2,100}$/;
const STATUS = new Set(["pending", "approved", "changes"]);
const BG = new Set(["light", "navy", "black"]);
const cut = (v: unknown, n: number) => String(v ?? "").slice(0, n);

function clean(raw: any) {
  const it: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return it;
  it.status = STATUS.has(raw.status) ? raw.status : "pending";
  if (raw.note) it.note = cut(raw.note, 3000);
  if (Array.isArray(raw.edits)) it.edits = raw.edits.slice(0, 60).map((x: unknown) => (x == null ? null : cut(x, 4000)));
  if (raw.edited) it.edited = true;
  if (raw.removed) it.removed = true;
  for (const k of ["by", "at", "atFull"]) if (raw[k]) it[k] = cut(raw[k], 80);
  return it;
}

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "campaigns", consistency: "strong" });
  try {
    if (req.method === "GET") {
      const c = new URL(req.url).searchParams.get("c") || "";
      if (!CAMP.test(c)) return json({ ok: false, error: "bad request" }, 400);
      const pre = `c/${c}/i/`;
      const { blobs } = await store.list({ prefix: pre });
      const items: Record<string, unknown> = {};
      await Promise.all(blobs.map(async (b) => { const v = await store.get(b.key, { type: "json" }); if (v) items[b.key.slice(pre.length)] = v; }));
      const bg: any = (await store.get(`c/${c}/bg`, { type: "json" })) || {};
      return json({ ok: true, state: { bg: BG.has(bg.bg) ? bg.bg : "light", items }, now: new Date().toISOString() });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
    const b: any = await req.json().catch(() => ({}));
    const c = String(b.c || ""), op = String(b.op || "");
    if (!CAMP.test(c)) return json({ ok: false, error: "bad request" }, 400);
    const user = decodeURIComponent(context.cookies.get("bmd_user") || "") || "someone";
    const now = new Date().toISOString();
    const put = (id: string, raw: any) => store.setJSON(`c/${c}/i/${id}`, { ...clean(raw), savedBy: user, savedAt: now });
    if (op === "item") {
      const id = String(b.id || "");
      if (!ID.test(id)) return json({ ok: false, error: "bad request" }, 400);
      await put(id, b.item);
      return json({ ok: true, savedAt: now });
    }
    if (op === "items") {
      const entries = Object.entries(b.items || {}).filter(([id]) => ID.test(id)).slice(0, 100);
      if (!entries.length) return json({ ok: false, error: "bad request" }, 400);
      await Promise.all(entries.map(([id, raw]) => put(id, raw)));
      return json({ ok: true, savedAt: now });
    }
    if (op === "bg") {
      if (!BG.has(b.bg)) return json({ ok: false, error: "bad request" }, 400);
      await store.setJSON(`c/${c}/bg`, { bg: b.bg, by: user, at: now });
      return json({ ok: true, savedAt: now });
    }
    if (op === "reset") {
      const pre = `c/${c}/i/`;
      const { blobs } = await store.list({ prefix: pre });
      await Promise.all(blobs.map(async (x) => {
        const v: any = await store.get(x.key, { type: "json" });
        if (v && v.removed) await store.setJSON(x.key, { status: "pending", removed: true, by: v.by || "", atFull: v.atFull || "", savedBy: user, savedAt: now });
        else await store.delete(x.key);
      }));
      return json({ ok: true, savedAt: now });
    }
    return json({ ok: false, error: "bad request" }, 400);
  } catch {
    return json({ ok: false, error: "storage unavailable" }, 502);
  }
};

export const config: Config = { path: "/api/campaigns", method: ["GET", "POST"] };
