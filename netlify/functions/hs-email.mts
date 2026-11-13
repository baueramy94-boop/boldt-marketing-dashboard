import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// The most recent 1:1 emails sent under one subject line, for the pop-up on the Sales Dashboard's 1:1 Emails page.
// GET /api/hs-email?subject=<subject line> -> { ok, emails: [{ d: "YYYY-MM-DD", owner, text, tracked, opens, clicks, replies }] }
// Only emails the healthcare sales reps sent (direction EMAIL) since Jan 1, 2026. Recipient names and addresses are
// never requested or returned; the email text is returned as written, and quoted earlier messages are cut off.
// Needs the sales-email-read permission on HUBSPOT_TOKEN. The edge gate has already checked the site password.

const API = "https://api.hubapi.com";
const SINCE = String(Date.UTC(2026, 0, 1));
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "private, max-age=300" } });
const norm = (v: any) => String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
const dayCT = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const plain = (html: string) => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
// Keep the rep's own message: stop at the first quoted earlier message.
const own = (t: string) => { const lines = t.replace(/\r/g, "").split("\n"); const cut = lines.findIndex((l) => /^\s*(On .{5,120} wrote:|-{2,}\s*Original Message|From:\s.+)/i.test(l) || /^\s*>/.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000); };

export default async (req: Request) => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) return json({ ok: false, error: "not connected" });
  const subject = (new URL(req.url).searchParams.get("subject") || "").trim().slice(0, 200);
  if (!subject) return json({ ok: false, error: "bad request" }, 400);
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const reps: any[] = ((await getStore("sales").get("reps", { type: "json" }).catch(() => null)) as any)?.data || [{ id: "128093036" }];
  const props = ["hs_timestamp", "hs_email_subject", "hs_email_text", "hs_email_html", "hs_email_direction", "hubspot_owner_id", "hs_email_open_count", "hs_email_click_count", "hs_email_reply_count"];
  const base = [{ propertyName: "hubspot_owner_id", operator: "IN", values: reps.map((r) => String(r.id)) }, { propertyName: "hs_email_direction", operator: "EQ", value: "EMAIL" },
    { propertyName: "hs_timestamp", operator: "GTE", value: SINCE }];
  const search = async (body: any) => { const r = await fetch(`${API}/crm/v3/objects/emails/search`, { method: "POST", headers: auth,
      body: JSON.stringify({ limit: 50, properties: props, sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }], ...body }) });
    return r.ok ? ((await r.json()) as any).results || [] : null; };
  try {
    // Exact subject first; if HubSpot won't filter on the subject, fall back to a text search and match the subject here.
    let rows = await search({ filterGroups: [{ filters: [...base, { propertyName: "hs_email_subject", operator: "EQ", value: subject }] }] });
    if (!rows || !rows.length) rows = await search({ query: subject.slice(0, 180), filterGroups: [{ filters: base }] });
    if (!rows) return json({ ok: false, error: "Couldn't read emails from HubSpot." }, 502);
    const emails = rows.filter((e: any) => norm(e.properties?.hs_email_subject) === norm(subject)).slice(0, 3).map((e: any) => { const p = e.properties || {};
      const has = (k: string) => p[k] != null && p[k] !== "";
      return { d: dayCT(p.hs_timestamp), owner: String(p.hubspot_owner_id || ""), text: own(p.hs_email_text || plain(String(p.hs_email_html || ""))),
        tracked: has("hs_email_open_count") || has("hs_email_click_count") || has("hs_email_reply_count"),
        opens: Number(p.hs_email_open_count) || 0, clicks: Number(p.hs_email_click_count) || 0, replies: Number(p.hs_email_reply_count) || 0 }; });
    return json({ ok: true, emails });
  } catch (e: any) {
    console.log(`hs-email failed: ${String(e?.message || e).slice(0, 200)}`);
    return json({ ok: false, error: "Couldn't read emails from HubSpot." }, 502);
  }
};

export const config: Config = { path: "/api/hs-email", method: ["GET"] };
