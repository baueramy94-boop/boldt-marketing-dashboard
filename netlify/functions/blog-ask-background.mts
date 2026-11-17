import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

/*
 * "Ask about this draft" (R&D tab, Generate Blog). Background function: the page POSTs { draftId, qid, question } to
 * /.netlify/functions/blog-ask-background, gets 202, and polls GET /api/blog?id=<draftId> (which returns the answers as `qa`).
 * Context: the draft, the earlier questions and answers on it, this week's briefing sources, and the messaging on
 * boldthealthcarerealestate.com (home page plus the pages it links to, cached a day in Blobs store "site-messaging").
 * Each answer is its own key in "blog-drafts": qa/<draftId>/<qid> = { qid, q, a?, status, by, at }.
 */

const MODELS = () => [Netlify.env.get("BLOG_MODEL"), Netlify.env.get("ASK_MODEL"), "claude-sonnet-5-5", "claude-sonnet-4-5"].filter(Boolean) as string[];
const SITE = "https://www.boldthealthcarerealestate.com";

function claude(): Anthropic | null {
  const e = process.env;
  if (e.ANTHROPIC_API_KEY || e.ANTHROPIC_BASE_URL) return new Anthropic();
  const own = Netlify.env.get("ANTHROPIC_API_KEY");
  if (own) return new Anthropic({ apiKey: own });
  const gw = e.NETLIFY_AI_GATEWAY_BASE_URL || e.NETLIFY_AI_GATEWAY_URL;
  if (gw && e.NETLIFY_AI_GATEWAY_KEY) return new Anthropic({ apiKey: null, authToken: e.NETLIFY_AI_GATEWAY_KEY, baseURL: gw.replace(/\/$/, "") + "/anthropic" });
  return null;
}

const SYSTEM = `You are the senior content strategist and editor for Boldt Real Estate, the healthcare real estate development and investment arm of The Boldt Group. You review blog drafts for Amy Copeland, Senior Marketing Manager, before she takes them to her manager and publishes them. Healthcare only: senior living is out of scope.

Answer Amy's question about the DRAFT directly and specifically. Point to the exact heading or sentence you mean (quote a few words). Be honest: if something is weak, risky or off-message, say so.

How to handle common questions:
- Red flags: claims or numbers not supported by the cited sources, promises Boldt can't guarantee (guaranteed savings, timelines, approvals), anything that reads as legal, tax or financial advice, services or project types Boldt's website doesn't show it offers, competitor or health system names (only Boldt projects may be named), senior living, tone that is salesy or generic, missing [bracketed] Boldt examples, and anything that could embarrass Boldt with a health system CFO.
- Selling Boldt more: specific places to add Boldt proof (a project, a capability, cost certainty, lowest responsible cost, financing options, development experience), stronger but still subtle calls to action, and internal links. Suggest the actual sentence to add.
- Website messaging: compare the draft with the WEBSITE pages. Say what matches, what is missing, and anything that contradicts or goes beyond what the website says Boldt does. Quote the website wording you compare against. If the website couldn't be read, say so and answer from the draft alone.
- Questions for my boss: write 4 to 8 questions only leadership can answer (what Boldt does and doesn't do, what to promote, positioning, which projects can be named, how far to go on claims). Base them on this draft. For each, add one short line on why it matters for this article. Example style: "Would we ever develop freestanding imaging centers?" or "Should we promote modular construction alongside phasing?"

Format: plain text. Short paragraphs and "- " bullets. Use **bold** sparingly for labels. No headings with #. Under 400 words unless Amy asks for more. Plain American English, no em dashes, none of these words: delve, landscape, navigate, leverage, robust, seamless, unlock, game-changer, pivotal, crucial.`;

const text = (html: string) => html
  .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<br\s*\/?>|<\/(p|h[1-6]|li|div)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, ", ").replace(/&[a-z#0-9]+;/gi, " ")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

async function siteMessaging(): Promise<{ pages: { url: string; text: string }[]; error?: string }> {
  const store = getStore({ name: "site-messaging", consistency: "strong" });
  const cached: any = await store.get("pages", { type: "json" }).catch(() => null);
  if (cached && Date.now() - cached.at < 24 * 3600 * 1000 && cached.pages?.length) return cached;
  const get = async (u: string) => { const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (compatible; BoldtDashboard/1.0)" }, signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.text(); };
  try {
    const home = await get(SITE + "/");
    const links = [...new Set([...home.matchAll(/href="(https:\/\/(?:www\.)?boldthealthcarerealestate\.com\/[^"#?]*)"/gi)].map((m) => m[1].replace("://boldt", "://www.boldt").replace(/\/?$/, "/")))]
      .filter((u) => !/\/(blog|wp-|tag|category|author|feed|privacy|terms|careers?)\b/i.test(u) && u !== SITE + "/").slice(0, 10);
    for (const u of [SITE + "/about/", SITE + "/lp-lowest-responsible-cost/"]) if (!links.includes(u)) links.push(u);
    const pages = [{ url: SITE + "/", text: text(home).slice(0, 5000) }];
    for (const u of links.slice(0, 12)) { try { pages.push({ url: u, text: text(await get(u)).slice(0, 4000) }); } catch {} }
    const out = { at: Date.now(), pages };
    await store.setJSON("pages", out).catch(() => {});
    return out;
  } catch (e: any) {
    if (cached?.pages?.length) return cached;
    return { pages: [], error: `The website couldn't be read (${String(e?.message || e).slice(0, 80)}).` };
  }
}

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "blog-drafts", consistency: "strong" });
  let b: any = {};
  try { b = await req.json(); } catch { return; }
  const draftId = String(b.draftId || ""), qid = String(b.qid || ""), q = String(b.question || "").trim().slice(0, 1000);
  if (!/^[a-z0-9-]{8,40}$/i.test(draftId) || !/^[a-z0-9]{6,24}$/i.test(qid) || !q) return;
  const user = decodeURIComponent(context.cookies.get("bmd_user") || "") || "Someone";
  const key = `qa/${draftId}/${qid}`, at = new Date().toISOString();
  const save = (o: any) => store.setJSON(key, { qid, q, by: user, at, ...o });
  await save({ status: "running" });
  try {
    const d: any = await store.get(draftId, { type: "json" });
    if (!d || d.status !== "done" || !d.blog) throw new Error("draft not found");
    const { schema, ...blog } = d.blog;
    const prior: any[] = [];
    for (const k of (await store.list({ prefix: `qa/${draftId}/` })).blobs) {
      if (k.key === key) continue;
      const x: any = await store.get(k.key, { type: "json" }).catch(() => null);
      if (x && x.status === "done") prior.push(x);
    }
    prior.sort((x, y) => String(x.at).localeCompare(String(y.at)));
    const site = await siteMessaging();
    const client = claude();
    if (!client) throw new Error("AI connection is not set up for the dashboard");
    const msg = `DRAFT (JSON):\n${JSON.stringify(blog)}\n\nWEBSITE (boldthealthcarerealestate.com page text):\n${site.pages.length ? site.pages.map((p) => `--- ${p.url}\n${p.text}`).join("\n") : site.error || "Not available."}\n\n${prior.length ? `EARLIER QUESTIONS ON THIS DRAFT:\n${prior.slice(-6).map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n\n")}\n\n` : ""}AMY'S QUESTION: ${q}`;
    let answer = "", lastErr: any = null;
    for (const model of MODELS()) {
      try {
        const res: any = await client.messages.create({ model, max_tokens: 2500, system: SYSTEM, messages: [{ role: "user", content: msg }] });
        answer = (res.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
        if (answer) break;
      } catch (e) { lastErr = e; }
    }
    if (!answer) throw lastErr || new Error("no answer");
    answer = answer.replace(/\s*—\s*/g, ", ").replace(/^#+\s*/gm, "");
    await save({ status: "done", a: answer, finished: new Date().toISOString(), site: site.pages.length ? site.pages.length : 0 });
    console.log(`blog-ask done draft=${draftId} qid=${qid} sitePages=${site.pages.length}`);
  } catch (e: any) {
    console.log(`blog-ask failed draft=${draftId}: ${e?.message || e}`);
    await save({ status: "failed", error: "That question couldn't be answered. Try again in a minute." });
  }
};
