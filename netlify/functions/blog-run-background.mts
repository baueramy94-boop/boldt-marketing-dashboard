import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

/*
 * Generate Blog (R&D tab). Background function: the page POSTs { id, topic?, why? } to
 * /.netlify/functions/blog-run-background, gets 202 right away, and polls /api/blog?id=<id>.
 * Context: this week's R&D briefing (public/data/rnd/<week>.json, every item with its source) and the dashboard's
 * data signals (public/data/rnd/signals.json). Output: a long-form, SEO and AEO ready article as JSON, saved to the
 * "blog-drafts" Blobs store. Healthcare only. Uses the same Claude connection as /api/ask (Netlify AI Gateway or a key).
 */

const MODELS = () => [Netlify.env.get("BLOG_MODEL"), Netlify.env.get("ASK_MODEL"), "claude-sonnet-5-5", "claude-sonnet-4-5"].filter(Boolean) as string[];

function claude(): Anthropic | null {
  const e = process.env;
  if (e.ANTHROPIC_API_KEY || e.ANTHROPIC_BASE_URL) return new Anthropic();
  const own = Netlify.env.get("ANTHROPIC_API_KEY");
  if (own) return new Anthropic({ apiKey: own });
  const gw = e.NETLIFY_AI_GATEWAY_BASE_URL || e.NETLIFY_AI_GATEWAY_URL;
  if (gw && e.NETLIFY_AI_GATEWAY_KEY) return new Anthropic({ apiKey: null, authToken: e.NETLIFY_AI_GATEWAY_KEY, baseURL: gw.replace(/\/$/, "") + "/anthropic" });
  return null;
}

const SYSTEM = `You write long-form thought leadership articles for Boldt Real Estate, the healthcare real estate development and investment arm of The Boldt Group. Boldt develops outpatient campuses, medical office buildings, ambulatory surgery centers and hospitals for health systems, and offers flexible development and financing options (health systems can own, lease or use other structures) with cost certainty and the lowest responsible cost.

Audience: health system executives (CEOs, CFOs, strategy, real estate and facilities leaders) and healthcare real estate decision-makers. Healthcare only: never mention senior living.

Rules:
- Executive insight, not generic commentary. Explain what a trend means for capital, sites of care, timing and risk, and what a leader should do next.
- Use only facts, numbers and quotes that appear in the CONTEXT, and name the source in the sentence (for example "according to Kaufman Hall"). Never invent statistics, quotes, clients or projects. Where first-hand Boldt experience would strengthen a point, write a bracketed placeholder such as [Add a Boldt project example: phased outpatient campus] for the team to fill in.
- E-E-A-T: show experience (placeholders for Boldt examples), expertise (practical detail), authority (cited sources) and trust (balanced, no hype).
- SEO and AEO: a clear H1, question-style H2s where natural, a short direct answer at the start of each section, scannable bullets, and an FAQ of 5 to 6 questions with 2 to 4 sentence answers written so AI search tools can quote them.
- Plain, confident American English. No em dashes. Avoid these words and phrases: delve, landscape, navigate, in today's, ever-evolving, game-changer, unlock, leverage (as a verb), robust, seamless, tapestry, realm, pivotal, crucial, "it's not just X, it's Y", "in conclusion".
- 1,400 to 1,900 words in the article body.

Call the save_blog tool once with the finished article. Do not write anything else.`;

const STR = { type: "string" }, ARR = { type: "array", items: { type: "string" } };
const TOOL = { name: "save_blog", description: "Save the finished blog article.", input_schema: { type: "object", required: ["title", "metaTitle", "metaDescription", "slug", "primaryKeyword", "intro", "sections", "keyTakeaways", "faq", "cta", "linkedin", "email", "sources"],
  properties: {
    title: { type: "string", description: "H1" }, metaTitle: { type: "string", description: "under 60 characters" }, metaDescription: { type: "string", description: "140 to 155 characters" },
    slug: STR, primaryKeyword: STR, secondaryKeywords: ARR, whyThisTopic: { type: "string", description: "1 to 2 sentences on why this topic now, citing the signals" },
    intro: { ...ARR, description: "2 to 3 paragraphs" },
    sections: { type: "array", description: "5 to 7 sections", items: { type: "object", required: ["h2", "paragraphs"], properties: { h2: STR, paragraphs: ARR, bullets: ARR } } },
    keyTakeaways: { ...ARR, description: "4 to 5" },
    faq: { type: "array", description: "5 to 6 questions, 2 to 4 sentence answers", items: { type: "object", required: ["q", "a"], properties: { q: STR, a: STR } } },
    cta: { type: "string", description: "one paragraph inviting readers to talk with Boldt" },
    schemaRecommendation: { type: "string", description: "one sentence on which schema types to add and why" },
    linkedin: { type: "object", required: ["post"], properties: { post: { type: "string", description: "120 to 200 words" }, thoughtLeaderAd: { type: "string", description: "1 to 2 sentence intro for a Thought Leader Ad" } } },
    email: { type: "object", required: ["subject", "body"], properties: { subject: STR, preview: STR, body: { type: "string", description: "100 to 150 words for health system leaders" } } },
    sources: { type: "array", description: "only CONTEXT sources the article uses", items: { type: "object", required: ["name", "url"], properties: { name: STR, url: STR } } } } } };

// Article and FAQPage JSON-LD, built here from the article (more reliable than asking the model for nested JSON).
const jsonld = (b: any) => JSON.stringify({ "@context": "https://schema.org", "@graph": [
  { "@type": "Article", headline: b.title, description: b.metaDescription, author: { "@type": "Organization", name: "Boldt Real Estate" }, publisher: { "@type": "Organization", name: "Boldt Real Estate" }, datePublished: new Date().toISOString().slice(0, 10), keywords: [b.primaryKeyword, ...(b.secondaryKeywords || [])].filter(Boolean).join(", ") },
  { "@type": "FAQPage", mainEntity: (b.faq || []).map((f: any) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] }, null, 2);

const clean = (v: any): any => typeof v === "string" ? v.replace(/\s*—\s*/g, ", ").replace(/\s+,/g, ",") : Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "jsonld" ? x : clean(x)])) : v;

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
    const site = async (p: string) => { const r = await fetch(new URL(p, req.url), { headers: { cookie } }); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };
    const ix: any = await site("/data/rnd/index.json");
    const week: any = await site(`/data/rnd/${ix.weeks[0].file}`);
    const signals: any = await site("/data/rnd/signals.json").catch(() => ({}));
    const recent: any = (await store.get("index", { type: "json" }).catch(() => null)) || { items: [] };
    const ctx = { briefing: { weekOf: week.weekOf, summary: week.summary, topStories: week.topStories, trends: week.trends, industry: week.industry, marketing: week.marketing, recommend: week.recommend, contentIdeas: week.contentIdeas },
      dashboardSignals: signals, recentlyGeneratedTitles: recent.items.slice(0, 10).map((x: any) => x.title) };
    const ask = b.topic
      ? `Write the article on this topic: "${String(b.topic).slice(0, 300)}".${b.why ? ` Why it was suggested: ${String(b.why).slice(0, 400)}` : ""}`
      : "Choose the single best topic for this week: it should align with Boldt's business (outpatient development, capital and financing options, sites of care), connect to a story or trend in the briefing, answer a question health system executives are asking, and build on what already performs (top content, strongest messaging themes, companies showing intent). Do not repeat a recently generated title. Then write the article.";
    const client = claude();
    if (!client) throw new Error("AI connection is not set up for the dashboard");
    let input: any = null, lastErr: any = null;
    for (const model of MODELS()) {
      try {
        const res: any = await client.messages.create({ model, max_tokens: 12000, system: SYSTEM, tools: [TOOL as any], tool_choice: { type: "tool", name: "save_blog" } as any,
          messages: [{ role: "user", content: `CONTEXT (JSON):\n${JSON.stringify(ctx)}\n\n${ask}` }] });
        const t = (res.content || []).find((c: any) => c.type === "tool_use");
        if (t && t.input) { input = t.input; break; }
        lastErr = new Error(`no article returned (stop: ${res.stop_reason})`);
      } catch (e) { lastErr = e; }
    }
    if (!input) throw lastErr || new Error("no response");
    const blog = clean(input);
    blog.schema = { recommendation: blog.schemaRecommendation || "Add Article and FAQPage schema so search engines and AI tools can read the article and its FAQ.", jsonld: jsonld(blog) };
    if (!blog.title || !Array.isArray(blog.sections)) throw new Error("the draft came back incomplete");
    blog.sources = (blog.sources || []).filter((s: any) => /^https:\/\//.test(s.url || ""));
    const words = [...(blog.intro || []), ...blog.sections.flatMap((s: any) => [...(s.paragraphs || []), ...(s.bullets || [])])].join(" ").split(/\s+/).length;
    await save({ status: "done", finished: new Date().toISOString(), weekOf: week.weekOf, words, blog });
    recent.items = [{ id, title: blog.title, by: user, created: started, words }, ...recent.items.filter((x: any) => x.id !== id)].slice(0, 25);
    await store.setJSON("index", recent);
    console.log(`blog-run done id=${id} words=${words}`);
  } catch (e: any) {
    console.log(`blog-run failed id=${id}: ${e?.message || e}`);
    await save({ status: "failed", error: "The draft couldn't be generated. Try again in a minute." , detail: String(e?.message || e).slice(0, 200) });
  }
};
