import type { Config, Context } from "@netlify/edge-functions";

// Shared-password gate for the whole site (works on any Netlify plan).
// SITE_PASSWORD and COOKIE_SECRET are environment variables scoped to Functions.
// If either is missing, nothing is served (fails closed).

const COOKIE = "bmd_auth";
const DAYS = 30;

async function sign(password: string, secret: string) {
  const data = new TextEncoder().encode(password + ":" + secret);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const page = (msg = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Boldt Marketing Dashboard</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--navy:#033D51;--yellow:#EBBC4E;--ink:#1B1B1B;--muted:#5C6670;--bg:#F3F4F5;--card:#fff;--line:#DADFE3}
@media (prefers-color-scheme:dark){:root{--ink:#EEF2F4;--muted:#A7B3BB;--bg:#0E1A20;--card:#14252D;--line:#25404B}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font-family:Archivo,system-ui,sans-serif;padding:16px}
form{background:var(--card);border:1px solid var(--line);border-top:4px solid var(--yellow);border-radius:14px;padding:28px;width:100%;max-width:380px;display:grid;gap:14px}
h1{font-size:20px;margin:0}p{margin:0;color:var(--muted);font-size:14px}label{display:grid;gap:6px;font-size:13px;font-weight:600}
input{font:inherit;font-size:16px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:inherit}
button{font:inherit;font-weight:700;padding:11px;border:0;border-radius:8px;background:var(--navy);color:#fff;cursor:pointer}
.err{color:#B5452F;font-weight:600}
</style></head><body><form method="post" action="/login">
<h1>Boldt Marketing Dashboard</h1><p>Enter the team password to continue.</p>${msg ? `<p class="err">${msg}</p>` : ""}
<label>Your name <input name="name" autocomplete="name" placeholder="Shown on calendar edits"></label>
<label>Password <input name="password" type="password" autocomplete="current-password" required autofocus></label>
<button type="submit">Open dashboard</button></form></body></html>`;

const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...headers } });

export default async (request: Request, context: Context) => {
  const password = Netlify.env.get("SITE_PASSWORD");
  const secret = Netlify.env.get("COOKIE_SECRET");
  if (!password || !secret) return html("Site is not configured yet.", 503);

  const url = new URL(request.url);
  const good = await sign(password, secret);

  if (url.pathname === "/login" && request.method === "POST") {
    const form = await request.formData();
    if (String(form.get("password") || "") !== password) return html(page("That password didn't match."), 401);
    const name = String(form.get("name") || "").trim().slice(0, 40);
    const h = new Headers({ location: "/", "cache-control": "no-store" });
    h.append("set-cookie", `${COOKIE}=${good}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`);
    h.append("set-cookie", `bmd_user=${encodeURIComponent(name)}; Path=/; Max-Age=${DAYS * 86400}; Secure; SameSite=Lax`);
    return new Response(null, { status: 303, headers: h });
  }
  if (url.pathname === "/logout") {
    const h = new Headers({ location: "/" });
    h.append("set-cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    return new Response(null, { status: 303, headers: h });
  }
  if (context.cookies.get(COOKIE) === good) return; // signed in: continue to the page or API
  if (url.pathname.startsWith("/api/")) return new Response(JSON.stringify({ ok: false, error: "signed out" }), { status: 401, headers: { "content-type": "application/json" } });
  return html(page(), 401);
};

export const config: Config = { path: "/*", onError: "fail" };
