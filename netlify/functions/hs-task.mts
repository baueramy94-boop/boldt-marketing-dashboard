import type { Config, Context } from "@netlify/functions";

// Create a follow-up task in HubSpot for a company on the dashboard.
// GET  /api/hs-task        -> { ok, ready, owners: [{ id, name }] }
// POST /api/hs-task        -> body { companyId, subject, notes, due: "YYYY-MM-DD", ownerId?, priority? } -> { ok, id, url }
// Needs HUBSPOT_TOKEN (a HubSpot private app access token with permission to read owners and write tasks) set in Netlify's
// environment variables. The edge gate has already checked the site password.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const API = "https://api.hubapi.com";
const ID = /^\d{1,20}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async (req: Request, context: Context) => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  const portal = Netlify.env.get("HUBSPOT_PORTAL") || "4587932";
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (req.method === "GET") {
    if (!token) return json({ ok: true, ready: false, owners: [] });
    try {
      const r = await fetch(`${API}/crm/v3/owners?limit=200&archived=false`, { headers: auth });
      if (!r.ok) return json({ ok: true, ready: true, owners: [], note: "owners unavailable" });
      const d: any = await r.json();
      const owners = (d.results || [])
        .map((o: any) => ({ id: String(o.id), name: [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || String(o.id) }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      return json({ ok: true, ready: true, owners });
    } catch {
      return json({ ok: true, ready: true, owners: [] });
    }
  }
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (!token) return json({ ok: false, error: "not connected" }, 503);
  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, error: "bad request" }, 400); }
  const companyId = String(b.companyId || "");
  const ownerId = b.ownerId ? String(b.ownerId) : "";
  const due = String(b.due || "");
  if (!ID.test(companyId) || (ownerId && !ID.test(ownerId)) || !DAY.test(due)) return json({ ok: false, error: "bad request" }, 400);
  const user = decodeURIComponent(context.cookies.get("bmd_user") || "") || "the marketing dashboard";
  const subject = String(b.subject || "Follow up").slice(0, 200);
  const notes = String(b.notes || "").slice(0, 2000) + `\n\nCreated from the Boldt marketing dashboard by ${user}.`;
  const priority = ["LOW", "MEDIUM", "HIGH"].includes(String(b.priority)) ? String(b.priority) : "MEDIUM";
  const properties: Record<string, string> = {
    hs_timestamp: new Date(`${due}T15:00:00Z`).toISOString(),
    hs_task_subject: subject,
    hs_task_body: notes,
    hs_task_status: "NOT_STARTED",
    hs_task_priority: priority,
    hs_task_type: "TODO",
  };
  if (ownerId) properties.hubspot_owner_id = ownerId;
  try {
    const r = await fetch(`${API}/crm/v3/objects/tasks`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        properties,
        associations: [{ to: { id: companyId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 192 }] }],
      }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) return json({ ok: false, error: d.message ? String(d.message).slice(0, 200) : `HubSpot error ${r.status}` }, 502);
    return json({ ok: true, id: d.id, url: `https://app.hubspot.com/contacts/${portal}/record/0-2/${companyId}` });
  } catch {
    return json({ ok: false, error: "HubSpot unavailable" }, 502);
  }
};

export const config: Config = { path: "/api/hs-task", method: ["GET", "POST"] };
