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
- Never name competitors (other healthcare real estate developers, investors, REITs or builders). Say "some developers" or "traditional developers" instead.
- Never name a health system, hospital or clinic. Describe it instead ("a large Midwest health system", "an academic medical center"). The only exception is a Boldt Real Estate project or case study listed in boldtProjects, which you may name when describing that project. This applies everywhere: headings, body, FAQ, anchor text, LinkedIn post, email and source names (use the publication's name, such as "Becker's Hospital Review", not an article title).
- 1,400 to 1,900 words in the article body.
- Links: write links inline as [anchor text](https://url) inside paragraphs, bullets and FAQ answers. Use descriptive anchor text, never "click here".
  - Internal: 3 to 6 links to Boldt pages, using only URLs from dashboardSignals.internalLinks. Link related Boldt blog posts where the topic overlaps.
  - External: 2 to 4 links to the CONTEXT sources the article cites, using only URLs that appear in the CONTEXT.
- Boldt CTAs: weave 2 to 3 subtle, helpful calls to action into the body (for example one sentence after a practical point, linking to the contact page or a related Boldt post). Low-key and specific to the point being made, never salesy or repeated.
- Photo: suggest one hero photo. Prefer an authentic Boldt project photo (a completed outpatient building, medical office building or construction progress) over stock; describe the shot, give alt text that includes the primary keyword, and avoid anything that looks AI-generated or shows frail patients.

Call the save_blog tool once with the finished article. Do not write anything else.`;

// Boldt projects and case studies a draft may name (with the client's name). Add more here as case studies are published.
const BOLDT_PROJECTS = [
  { project: "Multi-specialty medical office building on the PIH Health Whittier Hospital campus (Boldt Real Estate with The Boldt Company)", client: "PIH Health", url: "https://www.boldthealthcarerealestate.com/blog/boldt-real-estate-the-boldt-company-and-pih-health-break-ground-on-new-multi-specialty-medical-office-building-on-pih-health-whittier-hospital-campus/" },
];
const ALLOWED_NAMES = ["PIH Health", "PIH Health Whittier", "PIH Health Whittier Hospital", "Boldt Healthcare", "Boldt Health"];
// Competitors tracked in HubSpot AEO plus other national healthcare real estate developers and investors.
const COMPETITORS = ["NexCore", "Rendina", "Anchor Health Properties", "Remedy Medical Properties", "Catalyst Healthcare Real Estate", "Welltower", "Healthcare Realty", "Ventas", "Physicians Realty", "Medical Properties Trust",
  "Hammes", "Ryan Companies", "Mortenson", "Montecito Medical", "Harrison Street", "Trammell Crow", "Lillibridge", "Flagship Healthcare Properties", "Duke Realty", "Global Medical REIT", "MedCraft", "Stonemont", "Seavest", "Kayne Anderson", "Healthpeak", "Sabra", "Omega Healthcare", "Big Sky Medical"];
// Health systems that don't end in Health, Hospital, Clinic and so on.
const SYSTEMS = ["CommonSpirit", "Ascension", "Kaiser Permanente", "Tenet", "Intermountain", "Mass General Brigham", "UPMC", "Geisinger", "Baylor Scott & White", "Novant", "AdventHealth", "Ochsner", "Northwell", "NYU Langone", "Johns Hopkins",
  "Corewell", "Allina", "Froedtert", "Bon Secours", "Jefferson Health", "Penn Medicine", "Hackensack Meridian", "RWJBarnabas", "Memorial Hermann", "Houston Methodist", "LifePoint", "Ardent", "Steward", "Providence", "Advocate Aurora", "Mayo", "Sutter", "Atrium", "Sanford", "Prisma"];
const PUBS = /^(Becker's|Modern Healthcare|Fierce Healthcare|Healthcare Dive|Health Affairs|American Hospital|Healthcare Finance|Revcycle|Boldt)/i;
const STOP = new Set("The A An Your Our Their Its This That These Those Each Every Many Most Some Any Rural Urban Suburban Academic Community Nonprofit Not-for-profit For-profit Regional Large Larger Small Smaller Mid-size Midsize Independent Public Private When How What Why Which Where Who If For In At On With As And But Or So Home Global National Outpatient Inpatient Ambulatory Behavioral Specialty Acute Critical Access Primary Digital Population Value-based Traditional Modern Why US U.S. American Local State Federal Integrated Safety-net Teaching Veterans New Top Leading Major Multi-site Two Three One Hospital Health Healthcare Medical".split(" "));
function findNames(b: any): string[] {
  const txt = JSON.stringify([b.title, b.metaTitle, b.metaDescription, b.intro, b.sections, b.keyTakeaways, b.faq, b.cta, b.linkedin, b.email, (b.sources || []).map((s: any) => s.name), b.photo]);
  const found = new Set<string>();
  const re = /((?:[A-Z][A-Za-z'&.-]*\s+){1,4})(Health Systems?|Healthcare|Health|Hospitals?|Medical Centers?|Clinic|Health Network|Medicine|Children's)\b/g; let m;
  while ((m = re.exec(txt))) {
    const words = m[1].trim().split(/\s+/); while (words.length && STOP.has(words[0])) words.shift();
    if (!words.length) continue;
    const name = `${words.join(" ")} ${m[2]}`;
    if (PUBS.test(name) || ALLOWED_NAMES.some((a) => name.startsWith(a))) continue;
    found.add(name);
  }
  for (const n of [...COMPETITORS, ...SYSTEMS]) if (new RegExp(`\\b${n.replace(/[.&]/g, "\\$&")}\\b`).test(txt)) found.add(n);
  return [...found];
}

const STR = { type: "string" }, ARR = { type: "array", items: { type: "string" } };
const TOOL = { name: "save_blog", description: "Save the finished blog article.", input_schema: { type: "object", required: ["title", "metaTitle", "metaDescription", "slug", "primaryKeyword", "intro", "sections", "keyTakeaways", "faq", "cta", "linkedin", "email", "sources", "photo"],
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
    photo: { type: "object", required: ["suggestion", "altText"], properties: { suggestion: { type: "string", description: "the hero photo to use and why, preferring a real Boldt project photo" }, altText: { type: "string", description: "alt text with the primary keyword" }, caption: STR, stockSearch: { type: "string", description: "search terms if no Boldt photo fits" }, avoid: STR } },
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
      boldtProjects: BOLDT_PROJECTS, dashboardSignals: signals, recentlyGeneratedTitles: recent.items.slice(0, 10).map((x: any) => x.title) };
    const ask = b.topic
      ? `Write the article on this topic: "${String(b.topic).slice(0, 300)}".${b.why ? ` Why it was suggested: ${String(b.why).slice(0, 400)}` : ""}`
      : "Choose the single best topic for this week: it should align with Boldt's business (outpatient development, capital and financing options, sites of care), connect to a story or trend in the briefing, answer a question health system executives are asking, and build on what already performs (top content, strongest messaging themes, companies showing intent). Do not repeat a recently generated title. Then write the article.";
    const client = claude();
    if (!client) throw new Error("AI connection is not set up for the dashboard");
    let input: any = null, lastErr: any = null, used = "";
    for (const model of MODELS()) {
      try {
        const res: any = await client.messages.create({ model, max_tokens: 12000, system: SYSTEM, tools: [TOOL as any], tool_choice: { type: "tool", name: "save_blog" } as any,
          messages: [{ role: "user", content: `CONTEXT (JSON):\n${JSON.stringify(ctx)}\n\n${ask}` }] });
        const t = (res.content || []).find((c: any) => c.type === "tool_use");
        if (t && t.input) { input = t.input; used = model; break; }
        lastErr = new Error(`no article returned (stop: ${res.stop_reason})`);
      } catch (e) { lastErr = e; }
    }
    if (!input) throw lastErr || new Error("no response");
    // Names check: competitors and health systems that aren't Boldt projects get rewritten out in a second pass.
    let flagged = findNames(input);
    if (flagged.length) {
      console.log(`blog-run names id=${id}: ${flagged.join(", ")}`);
      try {
        const res: any = await client.messages.create({ model: used, max_tokens: 12000, system: SYSTEM, tools: [TOOL as any], tool_choice: { type: "tool", name: "save_blog" } as any,
          messages: [{ role: "user", content: `boldtProjects (the only health systems you may name): ${JSON.stringify(BOLDT_PROJECTS)}\n\nARTICLE (JSON):\n${JSON.stringify(input)}\n\nThis article names competitors or health systems that are not Boldt projects: ${flagged.join(", ")}. Rewrite only the sentences, headings, anchor text, FAQ answers, LinkedIn post, email and source names that contain them, describing each one generically instead (for example "a large health system in the Southeast" or "some developers"). Keep everything else exactly the same, including every link URL, and call save_blog with the full article.` }] });
        const t = (res.content || []).find((c: any) => c.type === "tool_use");
        if (t && t.input && t.input.title && Array.isArray(t.input.sections)) input = t.input;
      } catch (e: any) { console.log(`blog-run names rewrite failed id=${id}: ${e?.message || e}`); }
      flagged = findNames(input);
    }
    const blog = clean(input);
    if (flagged.length) blog.nameCheck = flagged;
    // Keep only links to Boldt pages we know exist and to sources in the context; anything else becomes plain text.
    const allowed = new Set<string>([...(signals.internalLinks || []).map((l: any) => l.url), ...JSON.stringify(week).match(/https:\/\/[^"\s)]+/g) || []]);
    const norm = (u: string) => u.replace(/[.,;]+$/, "");
    const fix = (v: any): any => typeof v === "string" ? v.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m: string, t: string, u: string) => (allowed.has(norm(u)) || /^https:\/\/www\.boldthealthcarerealestate\.com\/(contact|about|leadership|blog)\/?$/.test(norm(u)) ? `[${t}](${norm(u)})` : t))
      : Array.isArray(v) ? v.map(fix) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "sources" || k === "photo" ? x : fix(x)])) : v;
    Object.assign(blog, fix(blog));
    const linkCount = (JSON.stringify([blog.intro, blog.sections, blog.faq]).match(/\]\(https/g) || []).length;
    blog.schema = { recommendation: blog.schemaRecommendation || "Add Article and FAQPage schema so search engines and AI tools can read the article and its FAQ.", jsonld: jsonld(blog) };
    if (!blog.title || !Array.isArray(blog.sections)) throw new Error("the draft came back incomplete");
    blog.sources = (blog.sources || []).filter((s: any) => /^https:\/\//.test(s.url || ""));
    const words = [...(blog.intro || []), ...blog.sections.flatMap((s: any) => [...(s.paragraphs || []), ...(s.bullets || [])])].join(" ").split(/\s+/).length;
    await save({ status: "done", finished: new Date().toISOString(), weekOf: week.weekOf, words, links: linkCount, blog });
    recent.items = [{ id, title: blog.title, by: user, created: started, words }, ...recent.items.filter((x: any) => x.id !== id)].slice(0, 25);
    await store.setJSON("index", recent);
    console.log(`blog-run done id=${id} words=${words}`);
  } catch (e: any) {
    console.log(`blog-run failed id=${id}: ${e?.message || e}`);
    await save({ status: "failed", error: "The draft couldn't be generated. Try again in a minute." , detail: String(e?.message || e).slice(0, 200) });
  }
};
