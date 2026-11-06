import type { Config, Context } from "@netlify/functions";

// Read and update a HubSpot company's lifecycle stage from the dashboard.
// GET  /api/hs-company?ids=1,2,3   -> { ok, ready, stages: { id: stage }, outreach: { id: { date, type } },
//                                      tasks: { id: { open, next } } | null, tasksNote? }   (needs companies read; tasks also needs tasks read)
// POST /api/hs-company             -> body { companyId, lifecyclestage } -> { ok, stage }  (needs companies write)
// Uses the same HUBSPOT_TOKEN as hs-task. The edge gate has already checked the site password.

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const API = "https://api.hubapi.com";
const ID = /^\d{1,20}$/;
const STAGES = ["subscriber", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer", "evangelist", "other"];

export default async (req: Request, context: Context) => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (req.method === "GET") {
    if (!token) return json({ ok: true, ready: false, stages: {} });
    const ids = (new URL(req.url).searchParams.get("ids") || "").split(",").filter((x) => ID.test(x)).slice(0, 100);
    if (!ids.length) return json({ ok: true, ready: true, stages: {} });
    try {
      const r = await fetch(`${API}/crm/v3/objects/companies/batch/read`, {
        method: "POST", headers: auth,
        body: JSON.stringify({ properties: ["lifecyclestage", "hs_last_logged_outgoing_email_date", "hs_last_logged_call_date"], inputs: ids.map((id) => ({ id })) }),
      });
      if (!r.ok) return json({ ok: true, ready: true, stages: {}, note: `HubSpot ${r.status}` });
      const d: any = await r.json();
      const stages: Record<string, string> = {}, outreach: Record<string, any> = {};
      (d.results || []).forEach((x: any) => {
        const p = x.properties || {}, e = String(p.hs_last_logged_outgoing_email_date || "").slice(0, 10), c = String(p.hs_last_logged_call_date || "").slice(0, 10);
        stages[String(x.id)] = p.lifecyclestage || "";
        outreach[String(x.id)] = e || c ? { date: e >= c ? e : c, type: e >= c ? "1:1 email" : "Call" } : null;
      });
      const t = await openTasks(ids, auth);
      if (t.tasksNote) console.log(`open tasks check failed: ${t.tasksNote}`);
      return json({ ok: true, ready: true, stages, outreach, ...t });
    } catch {
      return json({ ok: true, ready: true, stages: {} });
    }
  }
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (!token) return json({ ok: false, error: "not connected" }, 503);
  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, error: "bad request" }, 400); }
  const id = String(b.companyId || ""), stage = String(b.lifecyclestage || "");
  if (!ID.test(id) || !STAGES.includes(stage)) return json({ ok: false, error: "bad request" }, 400);
  const patch = (v: string) => fetch(`${API}/crm/v3/objects/companies/${id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ properties: { lifecyclestage: v } }) });
  try {
    // HubSpot only moves a lifecycle stage backward after it is cleared, so a backward move clears it first,
    // and puts the old value back if the new one doesn't save.
    const cur = await fetch(`${API}/crm/v3/objects/companies/${id}?properties=lifecyclestage`, { headers: auth });
    if (cur.status === 401 || cur.status === 403) return json({ ok: false, error: "The HubSpot key can't read this company." }, 502);
    const was: string = ((await cur.json().catch(() => ({}))) as any).properties?.lifecyclestage || "";
    const back = was && STAGES.indexOf(stage) < STAGES.indexOf(was);
    let r: Response;
    if (back) {
      const c = await patch("");
      if (!c.ok) r = c;
      else { r = await patch(stage); if (!r.ok) await patch(was); }
    } else r = await patch(stage);
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = r.status === 403 ? "The HubSpot key needs permission to edit companies (crm.objects.companies.write)." : d.message ? String(d.message).slice(0, 200) : `HubSpot error ${r.status}`;
      return json({ ok: false, error: msg }, 502);
    }
    const user = decodeURIComponent(context.cookies.get("bmd_user") || "") || "dashboard";
    console.log(`lifecycle ${id} -> ${stage} by ${user}`);
    return json({ ok: true, stage: d.properties?.lifecyclestage ?? stage });
  } catch {
    return json({ ok: false, error: "HubSpot unavailable" }, 502);
  }
};

// Open (not completed) HubSpot tasks on each company: how many, and the earliest due date.
async function openTasks(ids: string[], auth: Record<string, string>): Promise<{ tasks: Record<string, any> | null; tasksNote?: string }> {
  try {
    const a = await fetch(`${API}/crm/v4/associations/companies/tasks/batch/read`, { method: "POST", headers: auth, body: JSON.stringify({ inputs: ids.map((id) => ({ id })) }) });
    if (!a.ok && a.status !== 207) return { tasks: null, tasksNote: `associations ${a.status}: ${String(((await a.json().catch(() => ({}))) as any).message || "").slice(0, 200)}` };
    const ad: any = await a.json();
    const byTask: Record<string, string[]> = {};
    (ad.results || []).forEach((r: any) => (r.to || []).forEach((t: any) => { (byTask[String(t.toObjectId)] ||= []).push(String(r.from?.id)); }));
    const tids = Object.keys(byTask).slice(0, 2000), tasks: Record<string, any> = {};
    ids.forEach((id) => (tasks[id] = { open: 0, next: "" }));
    const chunks: string[][] = []; for (let i = 0; i < tids.length; i += 100) chunks.push(tids.slice(i, i + 100));
    const res = await Promise.all(chunks.map((c) => fetch(`${API}/crm/v3/objects/tasks/batch/read`, {
      method: "POST", headers: auth, body: JSON.stringify({ properties: ["hs_task_status", "hs_timestamp"], inputs: c.map((id) => ({ id })) }),
    })));
    for (const r of res) {
      if (!r.ok && r.status !== 207) return { tasks: null, tasksNote: `tasks ${r.status}: ${String(((await r.json().catch(() => ({}))) as any).message || "").slice(0, 200)}` };
      const d: any = await r.json();
      (d.results || []).forEach((t: any) => {
        const p = t.properties || {};
        if (String(p.hs_task_status || "").toUpperCase() === "COMPLETED") return;
        const due = String(p.hs_timestamp || "").slice(0, 10);
        (byTask[String(t.id)] || []).forEach((cid) => { const o = tasks[cid]; if (!o) return; o.open++; if (due && (!o.next || due < o.next)) o.next = due; });
      });
    }
    return { tasks };
  } catch (e: any) {
    return { tasks: null, tasksNote: String(e?.message || "unavailable").slice(0, 200) };
  }
}

export const config: Config = { path: "/api/hs-company", method: ["GET", "POST"] };
