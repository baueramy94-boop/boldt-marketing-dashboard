import type { Config, Context } from "@netlify/functions";

// Server-side bridge to the Google Apps Script web app that stores the project calendar. The script URL and token stay here,
// never in the browser. The edge gate has already checked the site password.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req: Request, context: Context) => {
  const base = Netlify.env.get("SCRIPT_URL");
  const token = Netlify.env.get("SCRIPT_TOKEN");
  if (!base || !token) return json({ ok: false, error: "not configured" }, 503);

  const what = context.params.what;
  try {
    if (req.method === "GET") {
      if (what !== "tracker") return json({ ok: false, error: "not found" }, 404);
      const u = new URL(base);
      u.searchParams.set("token", token);
      u.searchParams.set("action", what);
      const r = await fetch(u, { redirect: "follow" });
      const text = await r.text();
      return new Response(text, { status: r.ok ? 200 : 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (req.method === "POST" && what === "tracker") {
      const body = await req.json();
      const user = decodeURIComponent(context.cookies.get("bmd_user") || "");
      const payload = { token, user, upserts: body.upserts || {}, deletes: body.deletes || {}, archiveIgnore: body.archiveIgnore };
      const r = await fetch(base, { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "text/plain;charset=utf-8" }, redirect: "follow" });
      const text = await r.text();
      return new Response(text, { status: r.ok ? 200 : 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    return json({ ok: false, error: "method not allowed" }, 405);
  } catch (err) {
    return json({ ok: false, error: "storage unreachable" }, 502);
  }
};

export const config: Config = { path: "/api/:what", method: ["GET", "POST"] };
