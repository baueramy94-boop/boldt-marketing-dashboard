import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Server-side bridge to the Google Apps Script web app that stores the project calendar. The script URL and token stay here,
// never in the browser. The edge gate has already checked the site password.
// Speed: GET answers from a copy kept in Netlify Blobs (store "tracker-cache") and refreshes it in the background, because the
// Apps Script takes a few seconds. A save clears the copy and sets a floor (the save time), so an older copy is never served
// after someone saves.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request, context: Context) => {
  const base = Netlify.env.get("SCRIPT_URL");
  const token = Netlify.env.get("SCRIPT_TOKEN");
  if (!base || !token) return json({ ok: false, error: "not configured" }, 503);

  const what = "tracker";
  try {
    if (req.method === "GET") {
      if (what !== "tracker") return json({ ok: false, error: "not found" }, 404);
      const store = getStore({ name: "tracker-cache", consistency: "strong" });
      const fetchLive = async () => {
        const u = new URL(base);
        u.searchParams.set("token", token);
        u.searchParams.set("action", what);
        const r = await fetch(u, { redirect: "follow" });
        const text = await r.text();
        let last = "";
        try { const j = JSON.parse(text); if (j.ok) last = String(j.lastSave || ""); else return { ok: false, text }; } catch { return { ok: false, text }; }
        const floor: any = await store.get("floor", { type: "json" }).catch(() => null);
        if (!floor || !floor.lastSave || last >= floor.lastSave) await store.setJSON("latest", { at: Date.now(), lastSave: last, text }).catch(() => {});
        return { ok: r.ok, text };
      };
      const [c, floor]: any = await Promise.all([store.get("latest", { type: "json" }).catch(() => null), store.get("floor", { type: "json" }).catch(() => null)]);
      const usable = c && c.text && (!floor || !floor.lastSave || (c.lastSave || "") >= floor.lastSave) && Date.now() - c.at < 6 * 3600 * 1000;
      if (usable && new URL(req.url).searchParams.get("fresh") !== "1") {
        if (Date.now() - c.at > 15000) context.waitUntil(fetchLive().catch(() => {}));
        return new Response(c.text, { headers: { "content-type": "application/json", "cache-control": "no-store", "x-tracker-cache": "hit" } });
      }
      const live = await fetchLive();
      return new Response(live.text, { status: live.ok ? 200 : 502, headers: { "content-type": "application/json", "cache-control": "no-store", "x-tracker-cache": "miss" } });
    }
    if (req.method === "POST" && what === "tracker") {
      const body = await req.json();
      const user = decodeURIComponent(context.cookies.get("bmd_user") || "");
      const payload = { token, user, upserts: body.upserts || {}, deletes: body.deletes || {}, archiveIgnore: body.archiveIgnore };
      const r = await fetch(base, { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "text/plain;charset=utf-8" }, redirect: "follow" });
      const text = await r.text();
      try {   // a save makes the cached copy stale: drop it and never serve anything older than this save
        const j = JSON.parse(text);
        if (j.ok) { const store = getStore({ name: "tracker-cache", consistency: "strong" }); await store.delete("latest"); if (j.savedAt) await store.setJSON("floor", { lastSave: String(j.savedAt) }); }
      } catch {}
      return new Response(text, { status: r.ok ? 200 : 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    return json({ ok: false, error: "method not allowed" }, 405);
  } catch (err) {
    return json({ ok: false, error: "storage unreachable" }, 502);
  }
};

export const config: Config = { path: "/api/tracker", method: ["GET", "POST"] };
