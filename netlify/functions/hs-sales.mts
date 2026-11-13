import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Sales Dashboard data (sales.html), live from HubSpot with HUBSPOT_TOKEN. Healthcare sales = Chris White and Heidi Lau.
// GET /api/hs-sales -> { ok, ready, asOf, reps: [{ id, name }], months: ["2026-01", ...],
//                        activity: { "2026-01": { <repId>: { calls, connected, voicemail, noAnswer, callMin, emails, replies,
//                                                           meetings, held, noShow, days, tasksDone, tasksNew } } },
//                        tasks: { byRep, aging, types, upcomingMeetings }, pipeline: { ... }, partial, health: [...] }
// Counts only: no contacts, subjects, bodies or task titles. Deal names are returned for the open deal list.
// Rules (keep in step with RUNBOOK.md, "Sales Dashboard"):
//   Calls     every logged call owned by the rep except inbound and canceled, by call time (Central).
//   Emails    1:1 emails the rep sent (hs_email_direction = EMAIL); replies = INCOMING_EMAIL owned by the rep.
//   Meetings  meetings owned by the rep by start time, canceled left out; held = start time passed and not a no-show.
//   Tasks     open = not Completed; overdue = same filter as Amy's HubSpot report (not In progress, Completed, Waiting
//             or Deferred, and past due).
//   Pipeline  deals in the pipelines named "Sales Pipeline" and "Warm Sales Pipeline".
// HubSpot's search allows about 5 requests a second, so months are built a few seconds at a time and kept in Netlify
// Blobs (store "sales"): finished months for 12 hours, the current month for 15 minutes. The page asks again while partial.

const API = "https://api.hubapi.com";
const REPS = [{ name: "Chris White", id: "128093036" }, { name: "Heidi Lau", id: "" }]; // ids missing here are looked up by name
const PIPELINES = ["sales pipeline", "warm sales pipeline"];
const YEAR = 2026;
const BUDGET_MS = 7000;
const TTL_DONE = 12 * 3600e3, TTL_CUR = 15 * 60e3, TTL_TASKS = 10 * 60e3, TTL_DEALS = 30 * 60e3, TTL_REPS = 24 * 3600e3;
const DISP: Record<string, string> = {
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "connected", "b2cf5968-551e-4856-9783-52b3da59a7d0": "voicemail",
  "a4c4c377-d246-4b32-a13b-75a56a4cd0ff": "voicemail", "73a0d17f-1163-4015-bdd5-ec830791da20": "noAnswer",
  "9d9162e7-6cf3-4944-bf63-4dff82258764": "noAnswer" };
const OPEN_EXCLUDE = new Set(["IN_PROGRESS", "COMPLETED", "WAITING", "DEFERRED"]);

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "private, max-age=60" } });
const ms = (v: any) => (v ? (/^\d+$/.test(String(v)) ? Number(v) : Date.parse(String(v))) : NaN);
const fmtCT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
const dayCT = (t: number) => fmtCT.format(new Date(t));
const sleep = (n: number) => new Promise((r) => setTimeout(r, n));

export default async (req: Request) => {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) return json({ ok: true, ready: false });
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const store = getStore("sales");
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const t0 = Date.now(), left = () => BUDGET_MS - (Date.now() - t0);
  const health: string[] = [];

  const hs = async (path: string, body?: unknown) => {
    for (let k = 0; ; k++) {
      const r = await fetch(API + path, body ? { method: "POST", headers: auth, body: JSON.stringify(body) } : { headers: auth });
      if (r.status === 429 && k < 4) { await sleep(600 + k * 400); continue; }
      if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status}: ${String(((await r.json().catch(() => ({}))) as any).message || "").slice(0, 160)}`);
      return (await r.json()) as any;
    }
  };
  const searchAll = async (obj: string, props: string[], filters: any[], sort: string, maxPages = 50) => {
    const out: any[] = []; let after: string | undefined;
    for (let p = 0; p < maxPages; p++) {
      const d = await hs(`/crm/v3/objects/${obj}/search`, { limit: 200, after, properties: props, sorts: [{ propertyName: sort, direction: "ASCENDING" }], filterGroups: [{ filters }] });
      out.push(...(d.results || [])); after = d.paging?.next?.after;
      if (!after) return { rows: out, truncated: false };
    }
    return { rows: out, truncated: true };
  };
  const count = async (obj: string, filters: any[]) => Number((await hs(`/crm/v3/objects/${obj}/search`, { limit: 1, properties: ["hs_object_id"], filterGroups: [{ filters }] })).total || 0);

  try {
    // 1. Reps: owner ids by name (kept for a day).
    let reps: { id: string; name: string }[] = (!fresh && (await cacheGet(store, "reps", TTL_REPS))) || [];
    if (!reps.length) {
      reps = REPS.filter((r) => r.id).map((r) => ({ ...r }));
      const need = REPS.filter((r) => !r.id);
      if (need.length) {
        try {
          const d = await hs(`/crm/v3/owners?limit=500&archived=false`);
          for (const n of need) {
            const o = (d.results || []).find((x: any) => `${x.firstName || ""} ${x.lastName || ""}`.trim().toLowerCase() === n.name.toLowerCase());
            if (o) reps.push({ id: String(o.id), name: n.name });
          }
        } catch (e: any) { health.push(`Owner lookup failed (${String(e?.message || e).slice(0, 120)}).`); }
      }
      if (reps.length === REPS.length) await store.setJSON("reps", { at: Date.now(), data: reps });
    }
    REPS.forEach((r) => { if (!reps.some((x) => x.name === r.name)) health.push(`${r.name} was not found as a HubSpot owner, so the numbers leave ${r.name.split(" ")[0]} out.`); });
    const ids = reps.map((r) => r.id);
    const ownerIn = { propertyName: "hubspot_owner_id", operator: "IN", values: ids };
    const blank = () => ({ calls: 0, connected: 0, voicemail: 0, noAnswer: 0, callMin: 0, emails: 0, replies: 0, meetings: 0, held: 0, noShow: 0, days: 0, tasksDone: 0, tasksNew: 0 });

    // 2. Activity by month and rep.
    const now = Date.now(), today = dayCT(now), curYM = today.slice(0, 7);
    const months: string[] = [];
    for (let m = 1; m <= 12; m++) { const ym = `${YEAR}-${String(m).padStart(2, "0")}`; if (ym <= curYM) months.push(ym); }
    const act: Record<string, any> = (await store.get("activity", { type: "json" }).catch(() => null)) || {};
    let partial = false;
    const buildMonth = async (ym: string) => {
      const [y, m] = ym.split("-").map(Number);
      // Central month, padded a day each side and trimmed by the Central date.
      const from = String(Date.UTC(y, m - 1, 1) - 864e5), to = String(Date.UTC(y, m, 1) + 864e5);
      const range = (prop: string) => [{ propertyName: prop, operator: "GTE", value: from }, { propertyName: prop, operator: "LT", value: to }];
      const [calls, emails, meets] = await Promise.all([
        searchAll("calls", ["hs_timestamp", "hs_call_direction", "hs_call_status", "hs_call_disposition", "hs_call_duration", "hubspot_owner_id"], [ownerIn, ...range("hs_timestamp")], "hs_timestamp"),
        searchAll("emails", ["hs_timestamp", "hs_email_direction", "hubspot_owner_id"], [ownerIn, ...range("hs_timestamp")], "hs_timestamp"),
        searchAll("meetings", ["hs_timestamp", "hs_meeting_start_time", "hs_meeting_outcome", "hubspot_owner_id"], [ownerIn, ...range("hs_timestamp")], "hs_timestamp"),
      ]);
      const out: Record<string, any> = {}, days: Record<string, Set<string>> = {};
      ids.forEach((id) => { out[id] = blank(); days[id] = new Set(); });
      const at = (x: any, prop = "hs_timestamp") => { const t = ms(x.properties?.[prop]) || ms(x.properties?.hs_timestamp); const d = t ? dayCT(t) : ""; return d.startsWith(ym) ? { t, d } : null; };
      calls.rows.forEach((c) => { const p = c.properties || {}, o = out[String(p.hubspot_owner_id)], w = at(c); if (!o || !w) return;
        if (String(p.hs_call_direction || "").toUpperCase() === "INBOUND" || String(p.hs_call_status || "").toUpperCase() === "CANCELED") return;
        o.calls++; days[p.hubspot_owner_id].add(w.d); const k = DISP[String(p.hs_call_disposition || "")]; if (k) o[k]++;
        o.callMin += (Number(p.hs_call_duration) || 0) / 60000; });
      emails.rows.forEach((e) => { const p = e.properties || {}, o = out[String(p.hubspot_owner_id)], w = at(e); if (!o || !w) return;
        const dir = String(p.hs_email_direction || "").toUpperCase();
        if (dir === "EMAIL") { o.emails++; days[p.hubspot_owner_id].add(w.d); } else if (dir === "INCOMING_EMAIL") o.replies++; });
      meets.rows.forEach((x) => { const p = x.properties || {}, o = out[String(p.hubspot_owner_id)], w = at(x, "hs_meeting_start_time"); if (!o || !w) return;
        const oc = String(p.hs_meeting_outcome || "").toUpperCase(); if (oc === "CANCELED") return;
        o.meetings++; if (oc === "NO_SHOW") o.noShow++; else if (w.t <= now) { o.held++; days[p.hubspot_owner_id].add(w.d); } });
      // Tasks completed and created in the month (counts only; UTC month edges shifted to Central standard time).
      const a = String(Date.UTC(y, m - 1, 1) + 6 * 3600e3), b = String(Date.UTC(y, m, 1) + 6 * 3600e3);
      for (const id of ids) {
        const own = { propertyName: "hubspot_owner_id", operator: "EQ", value: id };
        out[id].tasksDone = await count("tasks", [own, { propertyName: "hs_task_status", operator: "EQ", value: "COMPLETED" }, { propertyName: "hs_task_completion_date", operator: "GTE", value: a }, { propertyName: "hs_task_completion_date", operator: "LT", value: b }]);
        out[id].tasksNew = await count("tasks", [own, { propertyName: "hs_createdate", operator: "GTE", value: a }, { propertyName: "hs_createdate", operator: "LT", value: b }]);
        out[id].days = days[id].size; out[id].callMin = Math.round(out[id].callMin);
      }
      return { at: Date.now(), reps: ids.join(","), data: out, truncated: calls.truncated || emails.truncated || meets.truncated };
    };
    // Newest months first, so the report month shows before the rest of the year fills in.
    for (const ym of [...months].reverse()) {
      const c = act[ym], ttl = ym === curYM ? TTL_CUR : TTL_DONE;
      if (c && c.reps === ids.join(",") && !fresh && now - c.at < ttl) continue;
      if (left() < 2500) { partial = true; continue; }
      try { act[ym] = await buildMonth(ym); await store.setJSON("activity", act); }
      catch (e: any) { partial = !c; health.push(`Activity for ${ym} could not be read (${String(e?.message || e).slice(0, 140)}).`); break; }
    }
    const activity: Record<string, any> = {};
    months.forEach((ym) => { const c = act[ym]; if (c && c.reps === ids.join(",")) { activity[ym] = c.data; if (c.truncated) health.push(`${ym} has more activity than one pull returns; counts for that month are low.`); } else partial = true; });

    // 3. Open tasks and upcoming meetings.
    let tasks: any = (!fresh && (await cacheGet(store, "tasks", TTL_TASKS))) || null;
    if (!tasks && left() > 2000) {
      try {
        const open = await searchAll("tasks", ["hs_task_status", "hs_timestamp", "hs_createdate", "hs_task_priority", "hs_task_type", "hubspot_owner_id"],
          [ownerIn, { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" }], "hs_timestamp", 15);
        const wk = now + 7 * 864e5, byRep: Record<string, any> = {}, aging = { "1 to 7 days": 0, "8 to 30 days": 0, "31 to 90 days": 0, "Over 90 days": 0 }, types: Record<string, number> = {};
        ids.forEach((id) => (byRep[id] = { open: 0, overdue: 0, dueToday: 0, dueWeek: 0, later: 0, noDue: 0, working: 0, high: 0, oldest: 0 }));
        open.rows.forEach((t) => { const p = t.properties || {}, o = byRep[String(p.hubspot_owner_id)]; if (!o) return;
          const due = ms(p.hs_timestamp), st = String(p.hs_task_status || "").toUpperCase();
          o.open++; if (String(p.hs_task_priority || "").toUpperCase() === "HIGH") o.high++;
          const ty = { CALL: "Call", EMAIL: "Email", TODO: "To-do", LINKED_IN: "LinkedIn", LINKED_IN_MESSAGE: "LinkedIn", LINKED_IN_CONNECT: "LinkedIn", MEETING: "Meeting" }[String(p.hs_task_type || "TODO").toUpperCase()] || "Other";
          types[ty] = (types[ty] || 0) + 1;
          if (OPEN_EXCLUDE.has(st)) { o.working++; return; }
          if (!due) { o.noDue++; return; }
          if (dayCT(due) === today) o.dueToday++;
          else if (due < now) { o.overdue++; const d = Math.max(1, Math.floor((now - due) / 864e5)); o.oldest = Math.max(o.oldest, d);
            aging[d <= 7 ? "1 to 7 days" : d <= 30 ? "8 to 30 days" : d <= 90 ? "31 to 90 days" : "Over 90 days"]++; }
          else if (due <= wk) o.dueWeek++; else o.later++; });
        const up: Record<string, number> = {};
        for (const id of ids) up[id] = await count("meetings", [{ propertyName: "hubspot_owner_id", operator: "EQ", value: id }, { propertyName: "hs_timestamp", operator: "GT", value: String(now) }, { propertyName: "hs_timestamp", operator: "LTE", value: String(now + 30 * 864e5) }]);
        tasks = { byRep, aging, types, upcomingMeetings: up, truncated: open.truncated };
        await store.setJSON("tasks", { at: Date.now(), data: tasks });
      } catch (e: any) { health.push(`Open tasks could not be read (${String(e?.message || e).slice(0, 140)}).`); }
    } else if (!tasks) partial = true;
    if (tasks?.truncated) health.push("More than 3,000 open tasks; open task counts are low.");

    // 4. Pipeline: deals in the Sales Pipeline and Warm Sales Pipeline.
    let pipeline: any = (!fresh && (await cacheGet(store, "deals", TTL_DEALS))) || null;
    if (!pipeline && left() > 2000) {
      try {
        const pl = await hs(`/crm/v3/pipelines/deals`);
        const mine = (pl.results || []).filter((p: any) => PIPELINES.includes(String(p.label || "").trim().toLowerCase()));
        if (!mine.length) throw new Error(`no pipeline named ${PIPELINES.join(" or ")}; found ${(pl.results || []).map((p: any) => p.label).join(", ")}`);
        const stage: Record<string, any> = {};
        mine.forEach((p: any) => (p.stages || []).forEach((s: any) => (stage[s.id] = { label: s.label, order: s.displayOrder, pipeline: p.id,
          closed: String(s.metadata?.isClosed) === "true", won: String(s.metadata?.isClosed) === "true" && Number(s.metadata?.probability) >= 1 })));
        const deals = await searchAll("deals", ["dealname", "dealstage", "pipeline", "hubspot_owner_id", "createdate", "closedate", "amount", "notes_last_updated", "hs_v2_date_entered_current_stage"],
          [{ propertyName: "pipeline", operator: "IN", values: mine.map((p: any) => String(p.id)) }], "createdate", 25);
        const pm = (v: any) => { const t = ms(v); return t ? dayCT(t).slice(0, 7) : ""; };
        const monthly: Record<string, any> = {}; months.forEach((ym) => (monthly[ym] = { created: 0, won: 0, lost: 0 }));
        const open: any[] = []; let amount = 0;
        const stages = mine.map((p: any) => ({ id: String(p.id), label: p.label, stages: (p.stages || []).slice().sort((a: any, b: any) => a.displayOrder - b.displayOrder)
          .filter((s: any) => !stage[s.id].closed).map((s: any) => ({ id: s.id, label: s.label, n: 0, amount: 0 })) }));
        deals.rows.forEach((d) => { const p = d.properties || {}, s = stage[p.dealstage]; if (!s) return;
          const cm = pm(p.createdate); if (monthly[cm]) monthly[cm].created++;
          if (s.closed) { const km = pm(p.closedate); if (monthly[km]) monthly[km][s.won ? "won" : "lost"]++; return; }
          const a = Number(p.amount) || 0; amount += a;
          const row = stages.find((x: any) => x.id === String(p.pipeline))?.stages.find((x: any) => x.id === p.dealstage); if (row) { row.n++; row.amount += a; }
          const last = ms(p.notes_last_updated) || 0, ent = ms(p.hs_v2_date_entered_current_stage) || ms(p.createdate) || 0;
          open.push({ id: String(d.id), name: String(p.dealname || "Deal").slice(0, 120), stage: s.label, pipeline: String(p.pipeline), owner: String(p.hubspot_owner_id || ""),
            age: Math.floor((now - (ms(p.createdate) || now)) / 864e5), inStage: ent ? Math.floor((now - ent) / 864e5) : null, quiet: last ? Math.floor((now - last) / 864e5) : null }); });
        pipeline = { ready: true, stages, monthly, open, amount, truncated: deals.truncated };
        await store.setJSON("deals", { at: Date.now(), data: pipeline });
      } catch (e: any) { pipeline = { ready: false }; health.push(`Deals could not be read (${String(e?.message || e).slice(0, 200)}).`); }
    } else if (!pipeline) { pipeline = { ready: false, pending: true }; partial = true; }

    const data = { ok: true, ready: true, asOf: now, today, reps, months, activity, tasks, pipeline, partial, health };
    console.log(`hs-sales reps=${reps.length} months=${Object.keys(activity).length}/${months.length} partial=${partial} health=${health.length} ms=${Date.now() - t0}`);
    return json(data);
  } catch (e: any) {
    const detail = String(e?.message || e).slice(0, 300);
    console.log(`hs-sales failed: ${detail}`);
    return json({ ok: false, ready: true, error: "Couldn't read sales activity from HubSpot.", detail }, 502);
  }
};

async function cacheGet(store: any, key: string, ttl: number) {
  const c: any = await store.get(key, { type: "json" }).catch(() => null);
  return c && Date.now() - c.at < ttl ? c.data : null;
}

export const config: Config = { path: "/api/hs-sales", method: ["GET"] };
