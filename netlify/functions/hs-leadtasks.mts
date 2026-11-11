import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// MQL follow-up tasks ("marketing lead #1" tasks assigned to Chris White) for the Leads tab:
// the overdue list (same filters as Amy's HubSpot report) and speed to lead (task created -> completed or deleted).
// GET /api/hs-leadtasks -> { ok, asOf, overdue: [...], tasks: [{ c, a?, k? }], counts, scan }
// Returns company names only, never task titles or contacts (titles can carry a person's name).
// Deleted tasks only exist in HubSpot's archived list, which can't be filtered, so it is scanned a few seconds at a time
// across requests and the progress is kept in Netlify Blobs (store "leadtasks"). Results are cached for 10 minutes.

const API = "https://api.hubapi.com";
const OWNER = "128093036";             // Chris White
const MATCH = "marketing lead #1";     // task title contains (case-insensitive)
const SINCE = Date.UTC(2026, 0, 1);    // tasks created since Jan 1, 2026
const OPEN_EXCLUDE = new Set(["IN_PROGRESS", "COMPLETED", "WAITING", "DEFERRED"]);
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "private, max-age=120" } });
const ms = (v: any) => (v ? (/^\d+$/.test(String(v)) ? Number(v) : Date.parse(String(v))) : NaN);
const isLead = (p: any) => String(p?.hubspot_owner_id || "") === OWNER && String(p?.hs_task_subject || "").toLowerCase().includes(MATCH);
const PROPS = ["hs_task_subject", "hs_task_status", "hs_timestamp", "hs_createdate", "hs_task_completion_date", "hs_lastmodifieddate", "hubspot_owner_id"];

export default async (req: Request) => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) return json({ ok: true, ready: false });
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const store = getStore("leadtasks");
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const cached: any = await store.get("result", { type: "json" }).catch(() => null);
  if (cached && !fresh && Date.now() - cached.at < 10 * 60 * 1000) return json(cached.data);
  const t0 = Date.now();

  try {
    // 1. Live tasks for the owner created since SINCE (search), then keep the "marketing lead #1" ones.
    const live: any[] = []; let after: string | undefined;
    for (let p = 0; p < 40; p++) {
      const r = await fetch(`${API}/crm/v3/objects/tasks/search`, { method: "POST", headers: auth, body: JSON.stringify({
        limit: 200, after, properties: PROPS, sorts: [{ propertyName: "hs_createdate", direction: "ASCENDING" }],
        filterGroups: [{ filters: [{ propertyName: "hubspot_owner_id", operator: "EQ", value: OWNER }, { propertyName: "hs_createdate", operator: "GTE", value: String(SINCE) }] }] }) });
      if (!r.ok) throw new Error(`tasks search ${r.status}: ${String(((await r.json().catch(() => ({}))) as any).message || "").slice(0, 240)}`);
      const d: any = await r.json();
      (d.results || []).forEach((t: any) => { if (isLead(t.properties)) live.push(t); });
      after = d.paging?.next?.after; if (!after) break;
    }

    // 2. Deleted (archived) tasks: continue the scan from where the last request stopped, for up to ~6 seconds.
    const st: any = (await store.get("scan", { type: "json" }).catch(() => null)) || { after: "", restart: "", deleted: {}, passes: 0, done: false };
    let pages = 0;
    while (Date.now() - t0 < 6500) {
      const u = `${API}/crm/v3/objects/tasks?archived=true&limit=100&properties=${PROPS.join(",")}${st.after ? `&after=${encodeURIComponent(st.after)}` : ""}`;
      const r = await fetch(u, { headers: auth });
      if (!r.ok) throw new Error(`archived tasks ${r.status}: ${String(((await r.json().catch(() => ({}))) as any).message || "").slice(0, 240)}`);
      const d: any = await r.json(); pages++;
      for (const t of d.results || []) {
        const p = t.properties || {}, cr = ms(p.hs_createdate);
        // Remember where recent tasks start, so later passes skip years of old tasks.
        if (!st.restart && cr >= SINCE - 30 * 864e5) st.restart = st.after || "";
        if (isLead(p) && cr >= SINCE) st.deleted[t.id] = { c: cr, a: ms(t.archivedAt) || ms(p.hs_lastmodifieddate) || null, s: String(p.hs_task_status || ""), k: ms(p.hs_task_completion_date) || null };
      }
      const nx = d.paging?.next?.after;
      if (!nx) { st.after = st.restart || ""; st.passes++; st.done = true; break; }
      st.after = nx;
    }
    st.updated = Date.now();
    await store.setJSON("scan", st);

    // 3. Companies for the overdue tasks (task -> company, else task -> contact -> primary company).
    const now = Date.now();
    const od = live.filter((t) => { const p = t.properties || {}; return !OPEN_EXCLUDE.has(String(p.hs_task_status || "").toUpperCase()) && ms(p.hs_timestamp) < now; });
    const ids = od.map((t) => String(t.id));
    const assoc = async (to: string, list: string[]) => {
      const m: Record<string, string[]> = {};
      for (let i = 0; i < list.length; i += 1000) {
        const r = await fetch(`${API}/crm/v4/associations/tasks/${to}/batch/read`, { method: "POST", headers: auth, body: JSON.stringify({ inputs: list.slice(i, i + 1000).map((id) => ({ id })) }) });
        if (!r.ok && r.status !== 207) continue;
        const d: any = await r.json();
        (d.results || []).forEach((x: any) => (m[String(x.from?.id)] = (x.to || []).map((y: any) => String(y.toObjectId))));
      }
      return m;
    };
    const read = async (obj: string, list: string[], props: string[]) => {
      const out: Record<string, any> = {};
      for (let i = 0; i < list.length; i += 100) {
        const r = await fetch(`${API}/crm/v3/objects/${obj}/batch/read`, { method: "POST", headers: auth, body: JSON.stringify({ properties: props, inputs: list.slice(i, i + 100).map((id) => ({ id })) }) });
        if (!r.ok && r.status !== 207) continue;
        (((await r.json()) as any).results || []).forEach((x: any) => (out[String(x.id)] = x.properties || {}));
      }
      return out;
    };
    const [tc, tk] = ids.length ? await Promise.all([assoc("companies", ids), assoc("contacts", ids)]) : [{}, {}];
    const needContacts = ids.filter((id) => !(tc[id] || []).length).flatMap((id) => (tk[id] || []).slice(0, 1));
    const contacts = needContacts.length ? await read("contacts", [...new Set(needContacts)], ["associatedcompanyid"]) : {};
    const coOf = (id: string) => (tc[id] || [])[0] || (contacts[(tk[id] || [])[0]] || {}).associatedcompanyid || "";
    const coIds = [...new Set(ids.map(coOf).filter(Boolean))];
    const cos = coIds.length ? await read("companies", coIds, ["name", "domain"]) : {};
    const overdue = od.map((t) => { const p = t.properties || {}, cid = coOf(String(t.id));
      return { id: String(t.id), companyId: cid, company: (cos[cid] || {}).name || "", domain: (cos[cid] || {}).domain || "", due: ms(p.hs_timestamp), created: ms(p.hs_createdate) }; })
      .sort((a, b) => a.due - b.due);

    // 4. Speed to lead: every lead task since SINCE, created time and first action (completed or deleted).
    const tasks: any[] = [];
    const liveIds = new Set(live.map((t) => String(t.id)));
    live.forEach((t) => { const p = t.properties || {}; const done = String(p.hs_task_status || "").toUpperCase() === "COMPLETED";
      tasks.push({ c: ms(p.hs_createdate), ...(done ? { a: ms(p.hs_task_completion_date) || ms(p.hs_lastmodifieddate) || null, k: "done" } : {}) }); });
    Object.entries(st.deleted as Record<string, any>).forEach(([id, d]) => { if (liveIds.has(id)) return;
      tasks.push(d.s.toUpperCase() === "COMPLETED" && d.k ? { c: d.c, a: d.k, k: "done" } : { c: d.c, a: d.a, k: "del" }); });
    const data = { ok: true, ready: true, asOf: now, since: SINCE, overdue, tasks,
      counts: { live: live.length, deleted: Object.keys(st.deleted).length, overdue: overdue.length },
      scan: { complete: st.passes > 0, pages, passes: st.passes } };
    console.log(`hs-leadtasks live=${live.length} deleted=${Object.keys(st.deleted).length} overdue=${overdue.length} scanComplete=${st.passes > 0} pages=${pages} ms=${Date.now() - t0}`);
    if (st.passes > 0) await store.setJSON("result", { at: now, data });
    return json(data);
  } catch (e: any) {
    const detail = String(e?.message || e).slice(0, 300);
    console.log(`hs-leadtasks failed: ${detail}`);
    if (cached) return json({ ...cached.data, stale: true });
    return json({ ok: false, ready: true, error: "Couldn't read follow-up tasks from HubSpot.", detail }, 502);
  }
};

export const config: Config = { path: "/api/hs-leadtasks", method: ["GET"] };
