import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Awarded and in-construction projects for the ROI tab, live from the HubSpot Sales Pipeline.
// GET /api/hs-roi -> { ok, asOf, year, rate, projects: [{ id, name, stage, group, amount, reached, month }], excluded }
// Rules (Amy, Nov 19, 2026):
//  - Sales Pipeline deals in Awarded Not Financed / Pre-Development, Board Approval, Closed / In Construction or In Construction.
//  - A deal counts for the year when it first reached one of those stages in that year (or entered construction that year).
//  - Return = RATE x deal amount (project value). ROI and ROAS are worked out on the page with the workbook formulas.
//  - EXCLUDE lists duplicate deals left out on purpose (VMFH / Intuitive Puyallup Board Approval copy of VMFH Puyallup / Intuitive).
// Cached 10 minutes in Netlify Blobs (store "hs-roi").

const API = "https://api.hubapi.com";
const PIPELINE = "default";                    // Sales Pipeline
const AWARDED = ["decisionmakerboughtin", "contractsent"];   // Awarded Not Financed / Pre-Development, Board Approval
const BUILD = ["closedwon", "1432137869"];                   // Closed / In Construction, In Construction
const LABEL: Record<string, string> = { decisionmakerboughtin: "Awarded Not Financed / Pre-Development", contractsent: "Board Approval", closedwon: "Closed / In Construction", "1432137869": "In Construction" };
const RATE = 0.10;
const EXCLUDE = new Set(["64836372519"]);
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "private, max-age=120" } });
const ms = (v: any) => (v ? Date.parse(String(v)) : NaN);

export default async (req: Request) => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) return json({ ok: true, ready: false });
  const store = getStore("hs-roi");
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const cached: any = await store.get("result", { type: "json" }).catch(() => null);
  if (cached && !fresh && Date.now() - cached.at < 10 * 60 * 1000) return json(cached.data);
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
    const projects: any[] = [], excluded: any[] = [];
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
      (EXCLUDE.has(id) ? excluded : projects).push(row);
    }
    projects.sort((a, b) => a.reached - b.reached);
    const data = { ok: true, ready: true, asOf: Date.now(), year, rate: RATE, projects, excluded: excluded.map((x) => ({ id: x.id, name: x.name })) };
    await store.setJSON("result", { at: Date.now(), data });
    return json(data);
  } catch (e: any) {
    console.log(`hs-roi failed: ${e?.message || e}`);
    if (cached) return json({ ...cached.data, stale: true });
    return json({ ok: false, ready: true, error: "Couldn't read projects from HubSpot." }, 502);
  }
};

export const config: Config = { path: "/api/hs-roi", method: ["GET"] };
