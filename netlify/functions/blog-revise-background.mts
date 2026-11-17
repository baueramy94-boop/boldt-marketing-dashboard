import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { claude, SYSTEM, BOLDT_PROJECTS, siteMessaging, siteBlock, writeBlog, finish } from "../lib/blog-common.mts";

/*
 * Apply changes to a Generate Blog draft. Background function: the page POSTs
 *   { id, rid, changes: [{ text, qid?, idx?, cid? }] }
 * to /.netlify/functions/blog-revise-background and polls GET /api/blog?id=<id> until draft.revising.status is done or failed.
 * Changes come from "Ask about this draft" suggestions (qid + idx) or edit requests on the review page (cid).
 * The current version is kept in draft.versions (last 10) so it can be undone. The revised draft goes through the same
 * checks as a new one (website facts, names, links). Applied suggestions and edit requests are marked as applied.
 */

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "blog-drafts", consistency: "strong" });
  let b: any = {};
  try { b = await req.json(); } catch { return; }
  const id = String(b.id || ""), rid = String(b.rid || "");
  const changes: any[] = (Array.isArray(b.changes) ? b.changes : []).filter((c: any) => c && String(c.text || "").trim()).slice(0, 15);
  if (!/^[a-z0-9-]{8,40}$/i.test(id) || !/^[a-z0-9]{6,24}$/i.test(rid) || !changes.length) return;
  const user = decodeURIComponent(context.cookies.get("bmd_user") || "") || "Someone";
  const d: any = await store.get(id, { type: "json" }).catch(() => null);
  if (!d || d.status !== "done" || !d.blog) return;
  if (d.revising && d.revising.status === "running" && Date.now() - Date.parse(d.revising.at) < 10 * 60 * 1000) return;
  const at = new Date().toISOString();
  const note = changes.length === 1 ? String(changes[0].title || changes[0].text).slice(0, 120) : `${changes.length} changes`;
  await store.setJSON(id, { ...d, revising: { rid, status: "running", by: user, at, note } });
  try {
    const client = claude();
    if (!client) throw new Error("AI connection is not set up for the dashboard");
    const site = await siteMessaging();
    const { schema, nameCheck, ...article } = d.blog;
    const list = changes.map((c, i) => `${i + 1}. ${String(c.text).slice(0, 1500)}`).join("\n");
    const { input, used } = await writeBlog(client, SYSTEM, `boldtProjects: ${JSON.stringify(BOLDT_PROJECTS)}\n\nWEBSITE (boldthealthcarerealestate.com page text, the only source for Boldt facts):\n${siteBlock(site)}\n\nARTICLE (JSON):\n${JSON.stringify(article)}\n\nApply these changes to the article, and only these. Keep everything else the same, including the structure, the links and their URLs, the FAQ and the promotion copy, unless a change asks otherwise. Follow all the rules: any new wording about Boldt must be supported by the WEBSITE, and use a bracketed placeholder where Boldt detail is missing. Call save_blog with the full revised article.\n\nCHANGES:\n${list}`);
    const allowedUrls = [...(d.allowedUrls || []), ...site.pages.map((p) => p.url), ...((JSON.stringify(d.blog).match(/https:\/\/[^"\s)]+/g)) || [])];
    const { blog, words, links } = await finish(input, { client, used, allowedUrls, log: `blog-revise id=${id}` });
    const cur: any = (await store.get(id, { type: "json" }).catch(() => null)) || d;
    const versions = [{ at: cur.revisedAt || cur.finished, by: cur.revisedBy || cur.by, note: cur.revisedNote || "Original draft", words: cur.words, blog: cur.blog }, ...(cur.versions || [])].slice(0, 10);
    await store.setJSON(id, { ...cur, blog, words, links, versions, revisedAt: new Date().toISOString(), revisedBy: user, revisedNote: note, revising: { rid, status: "done", by: user, at, note } });
    // Mark what was applied.
    for (const c of changes) {
      if (c.qid && /^[a-z0-9]{6,24}$/i.test(c.qid)) {
        const k = `qa/${id}/${c.qid}`, x: any = await store.get(k, { type: "json" }).catch(() => null);
        if (x && Array.isArray(x.suggestions) && x.suggestions[c.idx]) { x.suggestions[c.idx].state = "applied"; x.suggestions[c.idx].by = user; await store.setJSON(k, x); }
      }
      if (c.cid && /^[a-z0-9]{6,24}$/i.test(c.cid)) {
        const k = `cm/${id}/${c.cid}`, x: any = await store.get(k, { type: "json" }).catch(() => null);
        if (x) { x.applied = true; x.appliedBy = user; x.resolved = true; await store.setJSON(k, x); }
      }
    }
    console.log(`blog-revise done id=${id} changes=${changes.length} words=${words} sitePages=${site.pages.length}`);
  } catch (e: any) {
    console.log(`blog-revise failed id=${id}: ${e?.message || e}`);
    const cur: any = (await store.get(id, { type: "json" }).catch(() => null)) || d;
    await store.setJSON(id, { ...cur, revising: { rid, status: "failed", by: user, at, note, error: "The changes couldn't be applied. Try again in a minute." } });
  }
};
