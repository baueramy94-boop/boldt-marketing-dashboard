import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Sales Pipeline projects for the ROI tab by phase (Lead, Verbal Award, Awarded Not Financed, Board Approval, In Construction), live from HubSpot.
// GET  /api/hs-roi -> { ok, asOf, year, rate, overheadMonthly, projects: [{ id, name, stage, group, amount, reached, month }],
//                       removed: [{ ...project, by, at }], subscribers: [count at each month end, or null for future months] }
// POST /api/hs-roi { action: remove | restore, id } -> remove a project from ROI or bring it back (shared, Blobs key "removed")
// POST /api/hs-roi { action: edit, id, fields: { name?, stage?, amount?, reached? (YYYY-MM-DD) } } / { action: reset, id }
//   -> dashboard-only corrections to a project (Blobs key "edits"). Never written back to HubSpot.
// Rules (Amy, Nov 19, 2026):
//  - Sales Pipeline deals in Awarded Not Financed / Pre-Development, Board Approval, Closed / In Construction or In Construction.
//  - A deal counts for the year when it first reached one of those stages in that year (or entered construction that year).
//  - Nov 24, 2026: deals now in Lead or Opportunity / Verbal Award are included too (group "lead" / "verbal"), counted for the
//    year they entered their current stage (or were created, if HubSpot has no stage date). The page works out ROI by phase.
//  - Return = RATE x deal amount (project value). ROI and ROAS are worked out on the page with the workbook formulas.
//  - Projects removed on the ROI tab are kept in Blobs (store "hs-roi", key "removed") and can be restored there. The first
//    removal (VMFH / Intuitive Puyallup, the Board Approval copy of VMFH Puyallup / Intuitive) is seeded from DEFAULT_REMOVED.
//  - Subscribers = companies in HubSpot (the Business Development portal) created by each month end, minus Boldt's own
//    company records (BOLDT_DOMAINS).
//  - OVERHEAD = healthcare overhead per month from the Healthcare Variables tab ($6,096,000 a year), used for Total ROI.
// Cached 10 minutes in Netlify Blobs (store "hs-roi").

const API = "https://api.hubapi.com";
const PIPELINE = "default";                    // Sales Pipeline
const EARLY = ["qualifiedtobuy", "presentationscheduled"];  // Lead, Opportunity / Verbal Award (not awarded yet)
const AWARDED = ["decisionmakerboughtin", "contractsent"];   // Awarded Not Financed / Pre-Development, Board Approval
const BUILD = ["closedwon", "1432137869"];                   // Closed / In Construction, In Construction
const LABEL: Record<string, string> = { qualifiedtobuy: "Lead", presentationscheduled: "Opportunity / Verbal Award", decisionmakerboughtin: "Awarded Not Financed / Pre-Development", contractsent: "Board Approval", closedwon: "Closed / In Construction", "1432137869": "In Construction" };
const RATE = 0.10;
const DEFAULT_REMOVED: Record<string, any> = { "64836372519": { by: "Amy", at: "2026-11-19T19:00:00Z", note: "Duplicate of VMFH Puyallup / Intuitive" } };
const BOLDT_DOMAINS = ["boldt.com", "boldthealthcarerealestate.com"];
const OVERHEAD = 508000;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ms = (v: any) => (v ? Date.parse(String(v)) : NaN);
const sleep = (t: number) => new Promise((r) => setTimeout(r, t));
// HubSpot search allows about 5 requests a second for the whole account, shared with the dashboard's other functions:
// space the calls out and retry a rate-limited (429) call a few times.
let lastCall = 0;
async function search(token: string, obj: string, body: any): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastCall + 260 - Date.now(); if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const r = await fetch(`${API}/crm/v3/objects/${obj}/search`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 429) { await sleep(Math.min(4000, (Number(r.headers.get("retry-after")) || 0) * 1000 || 700 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`${obj} search ${r.status}`);
    return r.json();
  }
  throw new Error(`${obj} search 429`);
}

async function removedList(store: any): Promise<Record<string, any>> {
  const r: any = await store.get("removed", { type: "json" }).catch(() => null);
  return r || { ...DEFAULT_REMOVED };
}
async function state(store: any) {
  const [removed, edits] = await Promise.all([removedList(store), store.get("edits", { type: "json" }).catch(() => null)]);
  return { removed, edits: (edits || {}) as Record<string, any> };
}
const GROUP_OF = (label: string) => (/construction/i.test(label) ? "construction" : label === "Lead" ? "lead" : /verbal/i.test(label) ? "verbal" : "awarded");
const VERSION = 2;   // bump when the cached pull changes shape (2 = Lead and Verbal Award added)
// Apply the shared removed list and dashboard edits at read time, so changes show up at once (the HubSpot pull stays cached).
function shape(data: any, st: { removed: Record<string, any>; edits: Record<string, any> }) {
  const removed = st.removed;
  const all = (data.all || []).map((p: any) => {
    const e = st.edits[p.id]; if (!e) return p;
    const f = e.fields || {}, q = { ...p, orig: { name: p.name, stage: p.stage, amount: p.amount, reached: p.reached }, edited: { by: e.by, at: e.at } };
    if (f.name) q.name = f.name;
    if (f.stage) { q.stage = f.stage; q.group = GROUP_OF(f.stage); }
    if (f.amount != null) q.amount = f.amount;
    if (f.reached) { q.reached = f.reached; q.month = new Date(f.reached).getUTCMonth(); }
    return q;
  }).sort((a: any, b: any) => a.reached - b.reached);
  return { ...data, all: undefined, projects: all.filter((p: any) => !removed[p.id]), removed: all.filter((p: any) => removed[p.id]).map((p: any) => ({ ...p, ...removed[p.id] })) };
}

export default async (req: Request, context: any) => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) return json({ ok: true, ready: false });
  const store = getStore({ name: "hs-roi", consistency: "strong" });
  if (req.method === "POST") {
    const b: any = await req.json().catch(() => ({}));
    const id = String(b.id || "");
    if (!/^\d{3,20}$/.test(id) || !["remove", "restore", "edit", "reset"].includes(b.action)) return json({ ok: false, error: "bad request" }, 400);
    const user = decodeURIComponent(context?.cookies?.get("bmd_user") || "") || "Someone";
    if (b.action === "edit" || b.action === "reset") {
      const edits: Record<string, any> = ((await store.get("edits", { type: "json" }).catch(() => null)) || {}) as any;
      if (b.action === "reset") delete edits[id];
      else {
        const f = b.fields || {}, clean: any = {};
        if (typeof f.name === "string" && f.name.trim()) clean.name = f.name.trim().slice(0, 200);
        if (typeof f.stage === "string" && Object.values(LABEL).includes(f.stage)) clean.stage = f.stage;
        if (f.amount != null && isFinite(+f.amount) && +f.amount >= 0 && +f.amount < 1e11) clean.amount = Math.round(+f.amount);
        if (typeof f.reached === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.reached)) clean.reached = Date.parse(f.reached + "T12:00:00Z");
        if (!Object.keys(clean).length) return json({ ok: false, error: "Nothing to save." }, 400);
        edits[id] = { fields: { ...((edits[id] || {}).fields || {}), ...clean }, by: user, at: new Date().toISOString() };
      }
      await store.setJSON("edits", edits);
    } else {
      const removed = await removedList(store);
      if (b.action === "remove") removed[id] = { by: user, at: new Date().toISOString() }; else delete removed[id];
      await store.setJSON("removed", removed);
    }
    const cached: any = await store.get("result", { type: "json" }).catch(() => null);
    return json(cached && Array.isArray(cached.data?.all) ? shape(cached.data, await state(store)) : { ok: true });
  }
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  let cached: any = await store.get("result", { type: "json" }).catch(() => null);
  if (cached && (!Array.isArray(cached.data?.all) || cached.data.v !== VERSION)) cached = null;   // older cache format
  if (cached && !fresh && Date.now() - cached.at < 10 * 60 * 1000) return json(shape(cached.data, await state(store)));
  const lock: any = await store.get("pulling", { type: "json" }).catch(() => null);
  if (lock && Date.now() - lock.at < 20000) {
    if (cached) return json({ ...shape(cached.data, await state(store)), stale: true });
    await sleep(6000);
    const c2: any = await store.get("result", { type: "json" }).catch(() => null);
    if (c2 && Array.isArray(c2.data?.all)) return json(shape(c2.data, await state(store)));
  }
  await store.setJSON("pulling", { at: Date.now() }).catch(() => {});
  try {
    const stages = [...AWARDED, ...BUILD], pull = [...EARLY, ...stages];
    const props = ["dealname", "dealstage", "amount", "amount_in_home_currency", "createdate", ...pull.map((s) => `hs_v2_date_entered_${s}`)];
    const deals: any[] = []; let after: string | undefined;
    for (let p = 0; p < 10; p++) {
      const d: any = await search(token, "deals", { limit: 200, after, properties: props, filterGroups: [{ filters: [{ propertyName: "pipeline", operator: "EQ", value: PIPELINE }, { propertyName: "dealstage", operator: "IN", values: pull }] }] });
      deals.push(...(d.results || []));
      after = d.paging?.next?.after; if (!after) break;
    }
    const year = new Date().getUTCFullYear(), y0 = Date.UTC(year, 0, 1), y1 = Date.UTC(year + 1, 0, 1);
    const inYear = (t: number) => t >= y0 && t < y1;
    const all: any[] = [];
    for (const d of deals) {
      const p = d.properties || {}, id = String(d.id), stage = String(p.dealstage);
      if (EARLY.includes(stage)) {
        // Lead / Verbal Award: the date it entered its current stage, or its create date.
        const t = ms(p[`hs_v2_date_entered_${stage}`]), when = isNaN(t) ? ms(p.createdate) : t;
        if (!inYear(when)) continue;
        all.push({ id, name: String(p.dealname || "").trim(), stage: LABEL[stage], group: stage === "qualifiedtobuy" ? "lead" : "verbal", amount: Number(p.amount_in_home_currency || p.amount || 0), reached: when, month: new Date(when).getUTCMonth() });
        continue;
      }
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
    // Subscribers: companies created by each month end, minus Boldt's own company records. Past months don't change, so they
    // are kept for a day (key "subscribers"); a failure here never blocks the project numbers.
    let subscribers: (number | null)[] | null = null;
    try {
      const prevSubs: any = await store.get("subscribers", { type: "json" }).catch(() => null);
      const fresh = prevSubs && prevSubs.year === year && Date.now() - prevSubs.at < 24 * 3600 * 1000 ? prevSubs.counts : null;
      const boldt: number[] = [];
      for (const dom of BOLDT_DOMAINS) {
        const r = await search(token, "companies", { limit: 50, properties: ["createdate"], filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: dom }] }] });
        (r.results || []).forEach((c: any) => boldt.push(ms(c.properties?.createdate)));
      }
      const now = Date.now(), cur = new Date(now).getUTCMonth();
      subscribers = [];
      for (let m = 0; m < 12; m++) {
        if (Date.UTC(year, m, 1) > now) { subscribers.push(null); continue; }
        if (fresh && m < cur && fresh[m] != null) { subscribers.push(fresh[m]); continue; }
        const end = Math.min(Date.UTC(year, m + 1, 1), now);
        const r = await search(token, "companies", { limit: 1, properties: ["createdate"], filterGroups: [{ filters: [{ propertyName: "createdate", operator: "LT", value: String(end) }] }] });
        subscribers.push(Number(r.total || 0) - boldt.filter((t) => t < end).length);
      }
      await store.setJSON("subscribers", { at: fresh ? prevSubs.at : Date.now(), year, counts: subscribers }).catch(() => {});
    } catch (e: any) {
      console.log(`hs-roi subscribers failed: ${e?.message || e}`);
      const prevSubs: any = await store.get("subscribers", { type: "json" }).catch(() => null);
      subscribers = prevSubs && prevSubs.year === year ? prevSubs.counts : null;
    }
    const data = { ok: true, ready: true, v: VERSION, asOf: Date.now(), year, rate: RATE, overheadMonthly: OVERHEAD, all, subscribers };
    await store.setJSON("result", { at: Date.now(), data });
    await store.delete("pulling").catch(() => {});
    return json(shape(data, await state(store)));
  } catch (e: any) {
    console.log(`hs-roi failed: ${e?.message || e}`);
    await store.delete("pulling").catch(() => {});
    if (cached) return json({ ...shape(cached.data, await state(store)), stale: true });
    return json({ ok: false, ready: true, error: "Couldn't read projects from HubSpot." }, 502);
  }
};

export const config: Config = { path: "/api/hs-roi", method: ["GET", "POST"] };
