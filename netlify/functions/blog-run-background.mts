import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { claude, SYSTEM, BOLDT_PROJECTS, siteMessaging, siteBlock, writeBlog, finish } from "../lib/blog-common.mts";

/*
 * Generate Blog (R&D tab). Background function: the page POSTs { id, topic?, why? } to
 * /.netlify/functions/blog-run-background, gets 202 right away, and polls /api/blog?id=<id>.
 * Context: this week's R&D briefing (public/data/rnd/<week>.json, every item with its source) and the dashboard's
 * data signals (public/data/rnd/signals.json), plus the text of boldthealthcarerealestate.com (the only source for Boldt facts). Output: a long-form, SEO and AEO ready article as JSON, saved to the
 * "blog-drafts" Blobs store. Healthcare only. Uses the same Claude connection as /api/ask (Netlify AI Gateway or a key).
 */

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "blog-drafts", consistency: "strong" });
  let b: any = {};
  try { b = await req.json(); } catch { return; }
  const id = String(b.id || "");
  if (!/^[a-z0-9-]{8,40}$/i.test(id)) return;
  const user = decodeURIComponent(context.cookies.get("bmd_user") || "") || "Someone";
  const started = new Date().toISOString();
  const save = (o: any) => store.setJSON(id, { id, started, by: user, topic: b.topic || "", ...o });
  await save({ status: "running" });
  try {
    const cookie = req.headers.get("cookie") || "";
    const own = async (p: string) => { const r = await fetch(new URL(p, req.url), { headers: { cookie } }); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };
    const ix: any = await own("/data/rnd/index.json");
    const week: any = await own(`/data/rnd/${ix.weeks[0].file}`);
    const signals: any = await own("/data/rnd/signals.json").catch(() => ({}));
    const recent: any = (await store.get("index", { type: "json" }).catch(() => null)) || { items: [] };
    const ctx = { briefing: { weekOf: week.weekOf, summary: week.summary, topStories: week.topStories, trends: week.trends, industry: week.industry, marketing: week.marketing, recommend: week.recommend, contentIdeas: week.contentIdeas },
      boldtProjects: BOLDT_PROJECTS, dashboardSignals: signals, recentlyGeneratedTitles: recent.items.slice(0, 10).map((x: any) => x.title) };
    const ask = b.topic
      ? `Write the article on this topic: "${String(b.topic).slice(0, 300)}".${b.why ? ` Why it was suggested: ${String(b.why).slice(0, 400)}` : ""}`
      : "Choose the single best topic for this week: it should align with Boldt's business (outpatient development, capital and financing options, sites of care), connect to a story or trend in the briefing, answer a question health system executives are asking, and build on what already performs (top content, strongest messaging themes, companies showing intent). Do not repeat a recently generated title. Then write the article.";
    const client = claude();
    if (!client) throw new Error("AI connection is not set up for the dashboard");
    const site = await siteMessaging();
    const { input, used } = await writeBlog(client, SYSTEM, `CONTEXT (JSON):\n${JSON.stringify(ctx)}\n\nWEBSITE (boldthealthcarerealestate.com page text, the only source for Boldt facts):\n${siteBlock(site)}\n\n${ask}`);
    const allowedUrls = [...(signals.internalLinks || []).map((l: any) => l.url), ...site.pages.map((p) => p.url), ...(JSON.stringify(week).match(/https:\/\/[^"\s)]+/g) || [])];
    const { blog, words, links: linkCount } = await finish(input, { client, used, allowedUrls, log: `blog-run id=${id}` });
    await save({ status: "done", finished: new Date().toISOString(), weekOf: week.weekOf, words, links: linkCount, sitePages: site.pages.length, allowedUrls, blog });
    recent.items = [{ id, title: blog.title, by: user, created: started, words }, ...recent.items.filter((x: any) => x.id !== id)].slice(0, 25);
    await store.setJSON("index", recent);
    console.log(`blog-run done id=${id} words=${words} links=${linkCount} sitePages=${site.pages.length}`);
  } catch (e: any) {
    console.log(`blog-run failed id=${id}: ${e?.message || e}`);
    await save({ status: "failed", error: "The draft couldn't be generated. Try again in a minute." , detail: String(e?.message || e).slice(0, 200) });
  }
};
