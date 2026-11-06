import type { Config } from "@netlify/functions";

// Checks what the dashboard's HubSpot key can read, without returning any record details.
// GET /api/hs-access -> { ok, checks: { name: { status, total?, error? } } }
// Used to see whether 1:1 outreach (calls and logged emails) and open tasks can be read with HUBSPOT_TOKEN.
// The edge gate has already checked the site password.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const API = "https://api.hubapi.com";
const FROM = String(Date.UTC(2026, 9, 1)), TO = String(Date.UTC(2026, 10, 1)); // October 2026

export default async () => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) return json({ ok: false, error: "HUBSPOT_TOKEN is not set" });
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const search = (obj: string, extra: any[] = []) => fetch(`${API}/crm/v3/objects/${obj}/search`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ limit: 1, properties: ["hs_timestamp"], filterGroups: [{ filters: [
      { propertyName: "hs_timestamp", operator: "GTE", value: FROM }, { propertyName: "hs_timestamp", operator: "LT", value: TO }, ...extra] }] }),
  });
  const tests: Record<string, () => Promise<Response>> = {
    "calls, October": () => search("calls"),
    "emails, October (all logged)": () => search("emails"),
    "emails, October (sent by Boldt)": () => search("emails", [{ propertyName: "hs_email_direction", operator: "EQ", value: "EMAIL" }]),
    "tasks, October": () => search("tasks"),
    "legacy engagements": () => fetch(`${API}/engagements/v1/engagements/paged?limit=1`, { headers: auth }),
    "company to calls associations": () => fetch(`${API}/crm/v4/associations/companies/calls/batch/read`, { method: "POST", headers: auth, body: JSON.stringify({ inputs: [{ id: "1" }] }) }),
  };
  const checks: Record<string, any> = {};
  await Promise.all(Object.entries(tests).map(async ([k, f]) => {
    try {
      const r = await f(); const d: any = await r.json().catch(() => ({}));
      checks[k] = r.ok || r.status === 207
        ? { status: r.status, can_read: true, ...(typeof d.total === "number" ? { total: d.total } : {}) }
        : { status: r.status, can_read: false, error: String(d.message || "").slice(0, 300) };
    } catch (e: any) { checks[k] = { can_read: false, error: String(e?.message || "unavailable").slice(0, 200) }; }
  }));
  console.log("hs-access", JSON.stringify(checks));
  return json({ ok: true, checks });
};

export const config: Config = { path: "/api/hs-access", method: ["GET"] };
