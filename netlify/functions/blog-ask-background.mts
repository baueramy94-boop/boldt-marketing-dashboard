import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { claude, MODELS, siteMessaging, siteBlock } from "../lib/blog-common.mts";

/*
 * "Ask about this draft" (R&D tab, Generate Blog). Background function: the page POSTs { draftId, qid, question } to
 * /.netlify/functions/blog-ask-background, gets 202, and polls GET /api/blog?id=<draftId> (which returns the answers as `qa`).
 * Context: the draft, the earlier questions and answers on it, this week's briefing sources, and the messaging on
 * boldthealthcarerealestate.com (home page plus the pages it links to, cached a day in Blobs store "site-messaging").
 * Each answer is its own key in "blog-drafts": qa/<draftId>/<qid> = { qid, q, a?, suggestions?: [{ title, change, state?: applied | deleted }], status, by, at }.
 * Suggestions can be applied to the draft (blog-revise-background) or deleted (POST /api/blog).
 */

const SYSTEM = `You are the senior content strategist and editor for Boldt Real Estate, the healthcare real estate development and investment arm of The Boldt Group. You review blog drafts for Amy Copeland, Senior Marketing Manager, before she takes them to her manager and publishes them. Healthcare only: senior living is out of scope.

Answer Amy's question about the DRAFT directly and specifically. Point to the exact heading or sentence you mean (quote a few words). Be honest: if something is weak, risky or off-message, say so.

How to handle common questions:
- Red flags: claims or numbers not supported by the cited sources, anything about Boldt that the WEBSITE doesn't support (Boldt facts must come only from the website or named Boldt projects), promises Boldt can't guarantee (guaranteed savings, timelines, approvals), anything that reads as legal, tax or financial advice, competitor or health system names (only Boldt projects may be named), senior living, tone that is salesy or generic, missing [bracketed] Boldt examples, and anything that could embarrass Boldt with a health system CFO.
- Selling Boldt more: specific places to add Boldt proof (a project, a capability, cost certainty, lowest responsible cost, financing options, development experience), stronger but still subtle calls to action, and internal links. Suggest the actual sentence to add.
- Questions for my boss: write 4 to 8 questions only leadership can answer (what Boldt does and doesn't do, what to promote, positioning, which projects can be named, how far to go on claims). Base them on this draft. For each, add one short line on why it matters for this article. Example style: "Would we ever develop freestanding imaging centers?" or "Should we promote modular construction alongside phasing?"

Whenever your answer recommends changing the draft, also list each change in suggestions (one per item, concrete enough to apply). Any new wording about Boldt must be supported by the WEBSITE.

Format: plain text. Short paragraphs and "- " bullets. Use **bold** sparingly for labels. No headings with #. Under 400 words unless Amy asks for more. Plain American English, no em dashes, none of these words: delve, landscape, navigate, leverage, robust, seamless, unlock, game-changer, pivotal, crucial.`;

const ANSWER = { name: "answer", description: "Answer Amy's question.", input_schema: { type: "object", required: ["answer", "suggestions"], properties: {
  answer: { type: "string", description: "the answer, plain text with short paragraphs and - bullets" },
  suggestions: { type: "array", description: "each concrete change to the draft that the answer recommends, one per item, so Amy can apply or delete it. Empty when the answer recommends no changes (for example questions for her boss).",
    items: { type: "object", required: ["title", "change"], properties: { title: { type: "string", description: "3 to 8 words" }, change: { type: "string", description: "exactly what to change and where, with the new wording where possible" } } } } } } };

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
    const msg = `DRAFT (JSON):\n${JSON.stringify(blog)}\n\nWEBSITE (boldthealthcarerealestate.com page text, the only source for Boldt facts):\n${siteBlock(site)}\n\n${prior.length ? `EARLIER QUESTIONS ON THIS DRAFT:\n${prior.slice(-6).map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n\n")}\n\n` : ""}QUESTION (from ${user}): ${q}`;
    let answer = "", suggestions: any[] = [], lastErr: any = null;
    for (const model of MODELS()) {
      try {
        const res: any = await client.messages.create({ model, max_tokens: 3000, system: SYSTEM, tools: [ANSWER as any], tool_choice: { type: "tool", name: "answer" } as any, messages: [{ role: "user", content: msg }] });
        const t = (res.content || []).find((c: any) => c.type === "tool_use");
        if (t && t.input && t.input.answer) { answer = String(t.input.answer).trim(); suggestions = (t.input.suggestions || []).filter((x: any) => x && x.change).slice(0, 12); break; }
        lastErr = new Error(`no answer (stop: ${res.stop_reason})`);
      } catch (e) { lastErr = e; }
    }
    if (!answer) throw lastErr || new Error("no answer");
    const dash = (v: string) => String(v || "").replace(/\s*—\s*/g, ", ");
    answer = dash(answer).replace(/^#+\s*/gm, "");
    suggestions = suggestions.map((x) => ({ title: dash(x.title).slice(0, 120), change: dash(x.change).slice(0, 1500) }));
    await save({ status: "done", a: answer, suggestions, finished: new Date().toISOString(), site: site.pages.length ? site.pages.length : 0 });
    console.log(`blog-ask done draft=${draftId} qid=${qid} sitePages=${site.pages.length}`);
  } catch (e: any) {
    console.log(`blog-ask failed draft=${draftId}: ${e?.message || e}`);
    await save({ status: "failed", error: "That question couldn't be answered. Try again in a minute." });
  }
};
