import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Awarded and in-construction projects for the ROI tab, live from the HubSpot Sales Pipeline.
// GET  /api/hs-roi -> { ok, asOf, year, rate, overheadMonthly, projects: [{ id, name, stage, group, amount, reached, month }],
//                       removed: [{ ...project, by, at }], subscribers: [count at each month end, or null for future months] }
// POST /api/hs-roi { action: remove | restore, id } -> remove a project from ROI or bring it back (shared, Blobs key "removed")
// Rules (Amy, Nov 19, 2026):
//  - Sales Pipeline deals in Awarded Not Financed / Pre-Development, Board Approval, Closed / In Construction or In Construction.
//  - A deal counts for the year when it first reached one of those stages in that year (or entered construction that year).
//  - Return = RATE x deal amount (project value). ROI and ROAS are worked out on the page with the workbook formulas.
//  - Projects removed on the ROI tab are kept in Blobs (store "hs-roi", key "removed") and can be restored there. The first
//    removal (VMFH / Intuitive Puyallup, the Board Approval copy of VMFH Puyallup / Intuitive) is seeded from DEFAULT_REMOVED.
//  - Subscribers = companies in HubSpot (the Business Development portal) created by each month end, minus Boldt's own
//    company records (BOLDT_DOMAINS).
//  - OVERHEAD = healthcare overhead per month from the Healthcare Variables tab ($6,096,000 a year), used for Total ROI.
// Cached 10 minutes in Netlify Blobs (store "hs-roi").

const API = "https://api.hubapi.com";
const PIPELINE = "default";                    // Sales Pipeline
const AWARDED = ["decisionmakerboughtin", "contractsent"];   // Awarded Not Financed / Pre-Development, Board Approval
const BUILD = ["closedwon", "1432137869"];                   // Closed / In Construction, In Construction
const LABEL: Record<string, string> = { decisionmakerboughtin: "Awarded Not Financed / Pre-Development", contractsent: "Board Approval", closedwon: "Closed / In Construction", "1432137869": "In Construction" };
const RATE = 0.10;
const DEFAULT_REMOVED: Record<string, any> = { "64836372519": { by: "Amy", at: "2026-11-19T19:00:00Z", note: "Duplicate of VMFH Puyallup / Intuitive" } };
const BOLDT_DOMAINS = ["boldt.com", "boldthealthcarerealestate.com"];
const OVERHEAD = 508000;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ms = (v: any) => (v ? Date.parse(String(v)) : NaN);

async function removedList(store: any): Promise<Record<string, any>> {
  const r: any = await store.get("removed", { type: "json" }).catch(() => null);
  return r || { ...DEFAULT_REMOVED };
}
// Apply the shared removed list at read time, so a remove or restore shows up at once (the HubSpot pull stays cached).
function shape(data: any, removed: Record<string, any>) {
  const all = data.all || [];
  return { ...data, all: undefined, projects: all.filter((p: any) => !removed[p.id]), removed: all.filter((p: any) => removed[p.id]).map((p: any) => ({ ...p, ...removed[p.id] })) };
}

export default async (req: Request, context: any) => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) return json({ ok: true, ready: false });
  const store = getStore({ name: "hs-roi", consistency: "strong" });
  if (req.method === "POST") {
    const b: any = await req.json().catch(() => ({}));
    const id = String(b.id || "");
    if (!/^\d{3,20}$/.test(id) || !["remove", "restore"].includes(b.action)) return json({ ok: false, error: "bad request" }, 400);
    const user = decodeURIComponent(context?.cookies?.get("bmd_user") || "") || "Someone";
    const removed = await removedList(store);
    if (b.action === "remove") removed[id] = { by: user, at: new Date().toISOString() }; else delete removed[id];
    await store.setJSON("removed", removed);
    const cached: any = await store.get("result", { type: "json" }).catch(() => null);
    return json(cached && Array.isArray(cached.data?.all) ? shape(cached.data, removed) : { ok: true });
  }
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  let cached: any = await store.get("result", { type: "json" }).catch(() => null);
  if (cached && !Array.isArray(cached.data?.all)) cached = null;   // older cache format
  if (cached && !fresh && Date.now() - cached.at < 10 * 60 * 1000) return json(shape(cached.data, await removedList(store)));
  try {
    const stages = [...AWARDED, ...BUILD];
    const props = ["dealname", "dealstage", "amount", "amount_in_home_currency", "createdate", ...stages.map((s) => `hs_v2_date_entered_${s}`)];
    const deals: any[] = []; let after: string | undefined;
    for (let p = 0; p < 10; p++) {
      const r = await fetch(`${API}/crm/v3/objects/deals/search`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ limit: 200, after, properties: props, filterGroups: [{ filters: [{ propertyName: "pipeline", operator: "EQ", value: PIPELINE }, { propertyName: "dealstage", operator: "IN", values: stages }] }] }) });
      if (!r.ok) throw new Error(`deals search ${r.status}`);
      const d: any = await r.json();
      deals.push(...(d.results || []));
      after = d.paging?.next?.after; if (!after) break;
    }
    const year = new Date().getUTCFullYear(), y0 = Date.UTC(year, 0, 1), y1 = Date.UTC(year + 1, 0, 1);
    const inYear = (t: number) => t >= y0 && t < y1;
    const all: any[] = [];
    for (const d of deals) {
      const p = d.properties || {}, id = String(d.id), stage = String(p.dealstage);
      const entered = stages.map((s) => ms(p[`hs_v2_date_entered_${s}`])).filter((t) => !isNaN(t));
      const first = entered.length ? Math.min(...entered) : ms(p.createdate);
      const group = BUILD.includes(stage) ? "construction" : "awarded";
      const builtThisYear = BUILD.map((s) => ms(p[`hs_v2_date_entered_${s}`])).some((t) => !isNaN(t) && inYear(t));
      const reachedInYear = entered.filter(inYear);
      if (!(inYear(first) || (group === "construction" && builtThisYear))) continue;
      const reached = reachedInYear.length ? Math.min(...reachedInYear) : first;
      const row = { id, name: String(p.dealname || "").trim(), stage: LABEL[stage] || stage, group, amount: Number(p.amount_in_home_currency || p.amount || 0), reached, month: new Date(reached).getUTCMonth() };
      all.push(row);
    }
    all.sort((a, b) => a.reached - b.reached);
    // Subscribers: companies created by each month end, minus Boldt's own company records.
    const count = async (filters: any[]) => {
      const r = await fetch(`${API}/crm/v3/objects/companies/search`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ limit: 1, properties: ["createdate"], filterGroups: [{ filters }] }) });
      if (!r.ok) throw new Error(`companies search ${r.status}`);
      return Number(((await r.json()) as any).total || 0);
    };
    const boldt: number[] = [];
    for (const dom of BOLDT_DOMAINS) {
      const r = await fetch(`${API}/crm/v3/objects/companies/search`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ limit: 50, properties: ["createdate"], filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: dom }] }] }) });
      if (r.ok) (((await r.json()) as any).results || []).forEach((c: any) => boldt.push(ms(c.properties?.createdate)));
    }
    const now = Date.now(), subscribers: (number | null)[] = [];
    for (let m = 0; m < 12; m++) {
      const end = Math.min(Date.UTC(year, m + 1, 1), now);
      if (Date.UTC(year, m, 1) > now) { subscribers.push(null); continue; }
      const n = await count([{ propertyName: "createdate", operator: "LT", value: String(end) }]);
      subscribers.push(n - boldt.filter((t) => t < end).length);
    }
    const data = { ok: true, ready: true, asOf: Date.now(), year, rate: RATE, overheadMonthly: OVERHEAD, all, subscribers };
    await store.setJSON("result", { at: Date.now(), data });
    return json(shape(data, await removedList(store)));
  } catch (e: any) {
    console.log(`hs-roi failed: ${e?.message || e}`);
    if (cached) return json({ ...shape(cached.data, await removedList(store)), stale: true });
    return json({ ok: false, ready: true, error: "Couldn't read projects from HubSpot." }, 502);
  }
};

export const config: Config = { path: "/api/hs-roi", method: ["GET", "POST"] };
