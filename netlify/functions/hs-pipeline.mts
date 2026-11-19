import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

/*
 * Sales insights for the ROI tab, live from the HubSpot Sales Pipeline (Amy, Nov 19, 2026).
 * GET /api/hs-pipeline -> { ok, asOf, stages: [{ id, label, order, prob, closed }], deals: [...], skipDays: [...] }
 *  deals: { id, name, stage, amount, created, entered: { stageId: ms }, award: ms|null, company, source,
 *           touch: { w, f, e, m } (first website visit, form fill, marketing email click, MQL, only if before the award),
 *           points (people x touch types before the award), first (earliest touch before the award) }
 * Marketing touch = anyone at the deal's company visited the website, filled out a form, clicked a marketing email or became
 * an MQL (Lead entered New) before the project was awarded. Touch data is only gathered for deals that reached Verbal Award or
 * later; "points" counts each person's first website visit, form fill and email click, plus each MQL, before the award. skipDays = days when many deals changed stage at once (bulk edits); stage times that end on those days are left out of
 * the time-in-phase figures by the page. Company names only; contacts are counted, never named.
 * Cached 30 minutes in Netlify Blobs (store "hs-pipeline"); ?fresh=1 skips the cache.
 */

const API = "https://api.hubapi.com";
const PIPELINE = "default";
const AWARD = ["presentationscheduled", "decisionmakerboughtin", "contractsent", "closedwon", "1432137869"];   // Verbal Award and later
const MQL_PROP = "hs_v2_date_entered_new_stage_id_1318266061";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ms = (v: any) => (v ? Date.parse(String(v)) : NaN);
const sleep = (t: number) => new Promise((r) => setTimeout(r, t));

let last = 0;
async function hs(token: string, path: string, body?: any): Promise<any> {
  const isSearch = path.endsWith("/search");
  for (let a = 0; a < 5; a++) {
    if (isSearch) { const wait = last + 260 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now(); }   // search: about 5 a second per account
    const r = await fetch(`${API}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { await sleep(Math.min(4000, (Number(r.headers.get("retry-after")) || 0) * 1000 || 700 * (a + 1))); continue; }
    if (r.status === 207 || r.ok) return r.json();
    throw new Error(`${path.split("?")[0]} ${r.status}`);
  }
  throw new Error(`${path.split("?")[0]} 429`);
}
async function assoc(token: string, from: string, to: string, ids: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (let i = 0; i < ids.length; i += 1000) {
    const d = await hs(token, `/crm/v4/associations/${from}/${to}/batch/read`, { inputs: ids.slice(i, i + 1000).map((id) => ({ id })) });
    (d.results || []).forEach((x: any) => (out[String(x.from?.id)] = (x.to || []).map((y: any) => String(y.toObjectId))));
  }
  return out;
}
async function read(token: string, obj: string, ids: string[], props: string[]): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const d = await hs(token, `/crm/v3/objects/${obj}/batch/read`, { properties: props, inputs: ids.slice(i, i + 100).map((id) => ({ id })) });
    (d.results || []).forEach((x: any) => (out[String(x.id)] = x.properties || {}));
  }
  return out;
}

export default async (req: Request) => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) return json({ ok: true, ready: false });
  const store = getStore({ name: "hs-pipeline", consistency: "strong" });
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const cached: any = await store.get("result", { type: "json" }).catch(() => null);
  if (cached && !fresh && Date.now() - cached.at < 30 * 60 * 1000) return json(cached.data);
  const lock: any = await store.get("pulling", { type: "json" }).catch(() => null);
  if (lock && Date.now() - lock.at < 25000) {
    if (cached) return json({ ...cached.data, stale: true });
    await sleep(8000);
    const c2: any = await store.get("result", { type: "json" }).catch(() => null);
    if (c2) return json(c2.data);
  }
  await store.setJSON("pulling", { at: Date.now() }).catch(() => {});
  const t0 = Date.now();
  try {
    // 1. Pipeline stages (order, probability) and every Sales Pipeline deal with its stage dates.
    const pl = await hs(token, `/crm/v3/pipelines/deals/${PIPELINE}`);
    const stages = (pl.stages || []).map((s: any) => ({ id: String(s.id), label: s.label, order: s.displayOrder, prob: s.metadata?.probability != null ? Number(s.metadata.probability) : null, closed: s.metadata?.isClosed === "true" }))
      .sort((a: any, b: any) => a.order - b.order);
    const props = ["dealname", "dealstage", "amount", "amount_in_home_currency", "createdate", ...stages.map((s: any) => `hs_v2_date_entered_${s.id}`)];
    const raw: any[] = []; let after: string | undefined;
    for (let p = 0; p < 10; p++) {
      const d = await hs(token, "/crm/v3/objects/deals/search", { limit: 200, after, properties: props, filterGroups: [{ filters: [{ propertyName: "pipeline", operator: "EQ", value: PIPELINE }] }] });
      raw.push(...(d.results || [])); after = d.paging?.next?.after; if (!after) break;
    }
    const deals = raw.map((d: any) => {
      const p = d.properties || {}, entered: Record<string, number> = {};
      stages.forEach((s: any) => { const t = ms(p[`hs_v2_date_entered_${s.id}`]); if (!isNaN(t)) entered[s.id] = t; });
      const aw = AWARD.map((s) => entered[s]).filter((t) => t != null);
      return { id: String(d.id), name: String(p.dealname || "").trim(), stage: String(p.dealstage), amount: Number(p.amount_in_home_currency || p.amount || 0), created: ms(p.createdate), entered,
        award: aw.length ? Math.min(...aw) : AWARD.includes(String(p.dealstage)) ? ms(p.createdate) : null } as any;
    });
    // Days with many stage changes at once (bulk edits): 8 or more stage entries on one day.
    const perDay: Record<string, number> = {};
    deals.forEach((d: any) => Object.values(d.entered).forEach((t: any) => { const k = new Date(t).toISOString().slice(0, 10); perDay[k] = (perDay[k] || 0) + 1; }));
    const skipDays = Object.entries(perDay).filter(([, n]) => n >= 8).map(([k]) => k).sort();

    // 2. Marketing touches before the award, for deals that reached Verbal Award or later.
    const awarded = deals.filter((d: any) => d.award != null);
    const d2c = await assoc(token, "deals", "companies", awarded.map((d: any) => d.id));
    const coIds = [...new Set(Object.values(d2c).flatMap((x) => x.slice(0, 1)))];
    const cos = coIds.length ? await read(token, "companies", coIds, ["name", "hs_analytics_source", "hs_analytics_first_visit_timestamp", "first_conversion_date"]) : {};
    // People who touched marketing: contacts at these companies (associations, then batch read) with a first website visit,
    // form fill or marketing email click. Capped so the pull stays quick; a failure here only drops the person-level touches.
    const people: Record<string, any> = {};
    let c2p: Record<string, string[]> = {}, peopleOk = true;
    try {
      c2p = coIds.length ? await assoc(token, "companies", "contacts", coIds) : {};
      const ids = [...new Set(Object.values(c2p).flat())].slice(0, 4000);
      Object.assign(people, ids.length ? await read(token, "contacts", ids, ["hs_analytics_first_visit_timestamp", "first_conversion_date", "hs_email_first_click_date"]) : {});
    } catch (e: any) { peopleOk = false; console.log(`hs-pipeline contacts skipped: ${e?.message || e}`); }
    const ppl = Object.keys(people);
    // MQLs: Lead records at these companies that entered New.
    let leadsOk = true, c2l: Record<string, string[]> = {}, leads: Record<string, any> = {};
    try {
      c2l = coIds.length ? await assoc(token, "companies", "leads", coIds) : {};
      const lids = [...new Set(Object.values(c2l).flat())];
      leads = lids.length ? await read(token, "leads", lids, [MQL_PROP]) : {};
    } catch (e: any) { leadsOk = false; console.log(`hs-pipeline leads skipped: ${e?.message || e}`); }

    for (const d of awarded) {
      const co = (d2c[d.id] || [])[0], c = co ? cos[co] || {} : {}, A = d.award;
      d.company = c.name || ""; d.source = c.hs_analytics_source || "";
      const before = (t: number) => !isNaN(t) && t < A;
      const touch: Record<string, number> = {}; let points = 0;
      const note = (k: string, t: number) => { if (before(t)) { touch[k] = touch[k] == null ? t : Math.min(touch[k], t); return 1; } return 0; };
      note("w", ms(c.hs_analytics_first_visit_timestamp)); note("f", ms(c.first_conversion_date));
      for (const pid of co ? c2p[co] || [] : []) {
        const p = people[pid] || {};
        points += note("w", ms(p.hs_analytics_first_visit_timestamp)) + note("f", ms(p.first_conversion_date)) + note("e", ms(p.hs_email_first_click_date));
      }
      for (const lid of co ? c2l[co] || [] : []) points += note("m", ms((leads[lid] || {})[MQL_PROP]));
      d.touch = touch; d.points = points;
      const ts = Object.values(touch); d.first = ts.length ? Math.min(...ts) : null;
    }
    const data = { ok: true, ready: true, asOf: Date.now(), stages, deals, skipDays, leadsOk, peopleOk };
    await store.setJSON("result", { at: Date.now(), data });
    await store.delete("pulling").catch(() => {});
    console.log(`hs-pipeline deals=${deals.length} awarded=${awarded.length} companies=${coIds.length} contacts=${ppl.length} leadsOk=${leadsOk} peopleOk=${peopleOk} ms=${Date.now() - t0}`);
    return json(data);
  } catch (e: any) {
    console.log(`hs-pipeline failed: ${e?.message || e}`);
    await store.delete("pulling").catch(() => {});
    if (cached) return json({ ...cached.data, stale: true });
    return json({ ok: false, ready: true, error: "Sales insights couldn't be loaded from HubSpot." }, 502);
  }
};

export const config: Config = { path: "/api/hs-pipeline", method: ["GET"] };
