import type { Config } from "@netlify/functions";

// 1:1 outreach for the "Engagement after 1:1 outreach" panel: calls and emails Boldt logged in HubSpot in a month,
// and the companies they are on. Returns no contacts, subjects or email bodies.
// Also ?company=<id>: that company's full call, email and reply history (see companyHistory).
// GET /api/hs-outreach?month=2026-10 -> { ok, ready, month, items: [{ t: "call" | "email", d: "YYYY-MM-DD", co: [companyId] }],
//                                         companies: { id: { n, d, i } }, truncated? }
// Calls: every logged call except inbound and canceled. Emails: emails sent by Boldt (hs_email_direction = EMAIL).
// Dates are Central time. Uses HUBSPOT_TOKEN (reads calls, emails and companies). The edge gate has already checked the password.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "private, max-age=600" } });

const API = "https://api.hubapi.com";
const MONTH = /^\d{4}-\d{2}$/;
const MAX_PAGES = 15; // 200 per page

const dayCT = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export default async (req: Request) => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) return json({ ok: true, ready: false });
  const company = new URL(req.url).searchParams.get("company") || "";
  if (company) return companyHistory(company, { authorization: `Bearer ${token}`, "content-type": "application/json" });
  const month = new URL(req.url).searchParams.get("month") || "";
  if (!MONTH.test(month)) return json({ ok: false, error: "bad month" }, 400);
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const [y, m] = month.split("-").map(Number);
  // Central time month bounds, padded a day each side and trimmed by the Central date below.
  const from = String(Date.UTC(y, m - 1, 1) - 86400000), to = String(Date.UTC(y, m, 1) + 86400000);
  let truncated = false;

  const search = async (obj: string, props: string[], extra: any[]) => {
    const out: any[] = []; let after: string | undefined;
    for (let p = 0; p < MAX_PAGES; p++) {
      const r = await fetch(`${API}/crm/v3/objects/${obj}/search`, {
        method: "POST", headers: auth,
        body: JSON.stringify({ limit: 200, after, properties: props, sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }],
          filterGroups: [{ filters: [{ propertyName: "hs_timestamp", operator: "GTE", value: from }, { propertyName: "hs_timestamp", operator: "LT", value: to }, ...extra] }] }),
      });
      if (!r.ok) throw new Error(`${obj} ${r.status}`);
      const d: any = await r.json();
      out.push(...(d.results || []));
      after = d.paging?.next?.after;
      if (!after) return out;
    }
    truncated = true; return out;
  };
  const assoc = async (obj: string, ids: string[]) => {
    const map: Record<string, string[]> = {};
    for (let i = 0; i < ids.length; i += 1000) {
      const r = await fetch(`${API}/crm/v4/associations/${obj}/companies/batch/read`, { method: "POST", headers: auth, body: JSON.stringify({ inputs: ids.slice(i, i + 1000).map((id) => ({ id })) }) });
      if (!r.ok && r.status !== 207) throw new Error(`${obj} associations ${r.status}`);
      const d: any = await r.json();
      (d.results || []).forEach((x: any) => { map[String(x.from?.id)] = (x.to || []).map((t: any) => String(t.toObjectId)); });
    }
    return map;
  };

  try {
    const [calls, emails] = await Promise.all([
      search("calls", ["hs_timestamp", "hs_call_direction", "hs_call_status"], []),
      search("emails", ["hs_timestamp"], [{ propertyName: "hs_email_direction", operator: "EQ", value: "EMAIL" }]),
    ]);
    const C = calls.filter((c) => {
      const p = c.properties || {};
      return String(p.hs_call_direction || "").toUpperCase() !== "INBOUND" && String(p.hs_call_status || "").toUpperCase() !== "CANCELED";
    });
    const [ca, ea] = await Promise.all([assoc("calls", C.map((c) => String(c.id))), assoc("emails", emails.map((e) => String(e.id)))]);
    const items: any[] = [];
    const add = (t: string, list: any[], map: Record<string, string[]>) => list.forEach((x) => {
      const ts = x.properties?.hs_timestamp; if (!ts) return;
      const d = dayCT(ts); if (!d.startsWith(month)) return;
      const co = map[String(x.id)] || []; if (co.length) items.push({ t, d, co });
    });
    add("call", C, ca); add("email", emails, ea);
    const ids = [...new Set(items.flatMap((x) => x.co))];
    const companies: Record<string, any> = {};
    for (let i = 0; i < ids.length; i += 100) {
      const r = await fetch(`${API}/crm/v3/objects/companies/batch/read`, { method: "POST", headers: auth,
        body: JSON.stringify({ properties: ["name", "domain", "industry"], inputs: ids.slice(i, i + 100).map((id) => ({ id })) }) });
      if (!r.ok && r.status !== 207) throw new Error(`companies ${r.status}`);
      const d: any = await r.json();
      (d.results || []).forEach((x: any) => { const p = x.properties || {}; companies[String(x.id)] = { n: p.name || "", d: p.domain || "", i: p.industry || "" }; });
    }
    return json({ ok: true, ready: true, month, items, companies, ...(truncated ? { truncated: true } : {}) });
  } catch (e: any) {
    console.log(`hs-outreach failed: ${e?.message || e}`);
    return json({ ok: false, ready: true, error: "Couldn't read 1:1 outreach from HubSpot." }, 502);
  }
};

// One company's full 1:1 history for its journey pop-up: every call, email Boldt sent and reply, by Central date.
// GET /api/hs-outreach?company=123 -> { ok, items: [{ t: "call" | "email" | "reply", d }] }   (no contacts, subjects or bodies)
async function companyHistory(id: string, auth: Record<string, string>) {
  if (!/^\d{1,20}$/.test(id)) return json({ ok: false, error: "bad company" }, 400);
  try {
    const ids = async (obj: string) => {
      const out: string[] = []; let after = "";
      for (let p = 0; p < 10; p++) {
        const r = await fetch(`${API}/crm/v4/objects/companies/${id}/associations/${obj}?limit=500${after ? `&after=${after}` : ""}`, { headers: auth });
        if (!r.ok) throw new Error(`${obj} associations ${r.status}`);
        const d: any = await r.json();
        (d.results || []).forEach((x: any) => out.push(String(x.toObjectId)));
        after = d.paging?.next?.after || ""; if (!after) break;
      }
      return out;
    };
    const read = async (obj: string, list: string[], props: string[]) => {
      const out: any[] = [];
      for (let i = 0; i < list.length; i += 100) {
        const r = await fetch(`${API}/crm/v3/objects/${obj}/batch/read`, { method: "POST", headers: auth, body: JSON.stringify({ properties: props, inputs: list.slice(i, i + 100).map((x) => ({ id: x })) }) });
        if (!r.ok && r.status !== 207) throw new Error(`${obj} ${r.status}`);
        out.push(...(((await r.json()) as any).results || []));
      }
      return out;
    };
    const [ci, ei] = await Promise.all([ids("calls"), ids("emails")]);
    const [calls, emails] = await Promise.all([
      read("calls", ci.slice(0, 2000), ["hs_timestamp", "hs_call_direction", "hs_call_status"]),
      read("emails", ei.slice(0, 2000), ["hs_timestamp", "hs_email_direction"]),
    ]);
    const items: any[] = [];
    calls.forEach((c) => { const p = c.properties || {};
      if (!p.hs_timestamp || String(p.hs_call_direction || "").toUpperCase() === "INBOUND" || String(p.hs_call_status || "").toUpperCase() === "CANCELED") return;
      items.push({ t: "call", d: dayCT(p.hs_timestamp) }); });
    emails.forEach((e) => { const p = e.properties || {}; if (!p.hs_timestamp) return;
      const dir = String(p.hs_email_direction || "").toUpperCase();
      if (dir === "EMAIL") items.push({ t: "email", d: dayCT(p.hs_timestamp) });
      else if (dir === "INCOMING_EMAIL") items.push({ t: "reply", d: dayCT(p.hs_timestamp) }); });
    items.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return json({ ok: true, items });
  } catch (e: any) {
    console.log(`hs-outreach company failed: ${e?.message || e}`);
    return json({ ok: false, error: "Couldn't read calls and emails from HubSpot." }, 502);
  }
}

export const config: Config = { path: "/api/hs-outreach", method: ["GET"] };
