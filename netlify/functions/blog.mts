import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { Document, Packer, Paragraph, HeadingLevel, TextRun, ExternalHyperlink } from "docx";
import { clean, jsonld } from "../lib/blog-common.mts";

// Generate Blog drafts (written by blog-run-background).
// GET /api/blog                 -> { ok, items: [{ id, title, by, created, words }] }   recent drafts
// GET /api/blog?id=<id>         -> { ok, draft: { status: running | done | failed, blog?, ... } }
// GET /api/blog?id=<id>&format=docx -> the draft as a Word document
// GET /api/blog?id=<id> also returns qa (Ask about this draft), comments (review page) and review ({ status, by, at }).
// POST /api/blog { action, id, ... }:
//   dismiss / undismiss { qid, idx }       delete or bring back a suggestion from an answer
//   comment { text, section?, kind: comment | edit, parent? }    review comments and edit requests
//   resolve { cid, resolved }   delcomment { cid }
//   review { status: approved | changes | "" }
//   edit { patch: { title?, intro?, sections?, keyTakeaways?, faq?, cta? } }   direct text edits (keeps the old version)
//   deletedraft                            delete the draft (Recent drafts), with its questions, comments and review status
//   restore                                undo the last change (applied suggestion, edit request or text edit)
// The edge gate has already checked the site password.

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function docx(b: any): Document {
  // Text with [anchor](url) links becomes runs with real hyperlinks.
  const runs = (t: string, o: any = {}) => { const out: any[] = []; let last = 0; const re = /\[([^\]]+)\]\((https?:[^)\s]+)\)/g; let m;
    while ((m = re.exec(t || ""))) { if (m.index > last) out.push(new TextRun({ text: t.slice(last, m.index), ...o }));
      out.push(new ExternalHyperlink({ link: m[2], children: [new TextRun({ text: m[1], style: "Hyperlink", ...o })] })); last = m.index + m[0].length; }
    if (last < (t || "").length) out.push(new TextRun({ text: t.slice(last), ...o })); return out; };
  const P = (t: string, o: any = {}) => new Paragraph({ children: runs(t, o), spacing: { after: 160 } });
  const H = (t: string, level: any) => new Paragraph({ text: t, heading: level, spacing: { before: 280, after: 120 } });
  const bullet = (t: string) => new Paragraph({ children: runs(t), bullet: { level: 0 } });
  const label = (k: string, v: string) => new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v || "")], spacing: { after: 80 } });
  const c: Paragraph[] = [];
  c.push(H(b.title, HeadingLevel.TITLE));
  if (b.photo) { c.push(label("Suggested photo", b.photo.suggestion)); if (b.photo.altText) c.push(label("Alt text", b.photo.altText)); if (b.photo.caption) c.push(label("Caption", b.photo.caption)); if (b.photo.stockSearch) c.push(label("If no Boldt photo fits, search", b.photo.stockSearch)); if (b.photo.avoid) c.push(label("Avoid", b.photo.avoid)); }
  (b.intro || []).forEach((t: string) => c.push(P(t)));
  for (const s of b.sections || []) {
    c.push(H(s.h2, HeadingLevel.HEADING_1));
    (s.paragraphs || []).forEach((t: string) => c.push(P(t)));
    (s.bullets || []).forEach((t: string) => c.push(bullet(t)));
  }
  if ((b.keyTakeaways || []).length) { c.push(H("Key takeaways", HeadingLevel.HEADING_1)); b.keyTakeaways.forEach((t: string) => c.push(bullet(t))); }
  if ((b.faq || []).length) { c.push(H("Frequently asked questions", HeadingLevel.HEADING_1)); for (const f of b.faq) { c.push(H(f.q, HeadingLevel.HEADING_2)); c.push(P(f.a)); } }
  if (b.cta) c.push(P(b.cta, { italics: true }));
  if ((b.sources || []).length) {
    c.push(H("Sources", HeadingLevel.HEADING_1));
    for (const s of b.sources) c.push(new Paragraph({ bullet: { level: 0 }, children: [new ExternalHyperlink({ link: s.url, children: [new TextRun({ text: s.name, style: "Hyperlink" })] })] }));
  }
  c.push(H("SEO and AEO details", HeadingLevel.HEADING_1));
  c.push(label("Meta title", b.metaTitle)); c.push(label("Meta description", b.metaDescription)); c.push(label("URL slug", b.slug));
  c.push(label("Primary keyword", b.primaryKeyword)); c.push(label("Secondary keywords", (b.secondaryKeywords || []).join(", ")));
  if (b.schema) { c.push(label("Schema", b.schema.recommendation)); if (b.schema.jsonld) c.push(P(typeof b.schema.jsonld === "string" ? b.schema.jsonld : JSON.stringify(b.schema.jsonld, null, 2), { font: "Consolas", size: 18 })); }
  c.push(H("Promotion", HeadingLevel.HEADING_1));
  if (b.linkedin) { c.push(H("LinkedIn post", HeadingLevel.HEADING_2)); c.push(P(b.linkedin.post || "")); if (b.linkedin.thoughtLeaderAd) c.push(label("Thought Leader Ad intro", b.linkedin.thoughtLeaderAd)); }
  if (b.email) { c.push(H("Email", HeadingLevel.HEADING_2)); c.push(label("Subject", b.email.subject)); c.push(label("Preview text", b.email.preview)); c.push(P(b.email.body || "")); }
  if ((b.reviewQuestions || []).length) { c.push(H("Questions to confirm before publishing", HeadingLevel.HEADING_2)); for (const r of b.reviewQuestions) c.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: r.q, bold: true }), new TextRun(r.why ? ` ${r.why}` : "")] })); }
  if (b.whyThisTopic) { c.push(H("Why this topic", HeadingLevel.HEADING_2)); c.push(P(b.whyThisTopic)); }
  return new Document({ creator: "Boldt Marketing Dashboard", title: b.title, styles: { default: { document: { run: { font: "Calibri", size: 22 } } } }, sections: [{ children: c }] });
}

const isStrArr = (a: any, max = 40) => Array.isArray(a) && a.length <= max && a.every((x: any) => typeof x === "string" && x.length <= 6000);
const okId = (v: any) => /^[a-z0-9]{6,24}$/i.test(String(v || ""));

async function post(req: Request, context: Context, store: any) {
  const b: any = await req.json().catch(() => ({}));
  const id = String(b.id || ""), act = String(b.action || "");
  if (!/^[a-z0-9-]{8,40}$/i.test(id)) return json({ ok: false, error: "bad id" }, 400);
  const user = decodeURIComponent(context.cookies.get("bmd_user") || "") || "Someone";
  const now = new Date().toISOString();
  if (act === "deletedraft") {   // remove from Recent drafts and delete the draft with its questions, comments and review status
    const ix: any = (await store.get("index", { type: "json" }).catch(() => null)) || { items: [] };
    ix.items = (ix.items || []).filter((x: any) => x.id !== id);
    await store.setJSON("index", ix);
    for (const pre of [`qa/${id}/`, `cm/${id}/`]) { const { blobs } = await store.list({ prefix: pre }).catch(() => ({ blobs: [] as any[] })); for (const k of blobs) await store.delete(k.key).catch(() => {}); }
    await store.delete(`rv/${id}`).catch(() => {}); await store.delete(id).catch(() => {});
    console.log(`blog draft deleted id=${id} by=${user}`);
    return json({ ok: true, items: ix.items });
  }
  const d: any = await store.get(id, { type: "json" }).catch(() => null);
  if (!d || d.status !== "done") return json({ ok: false, error: "draft not found" }, 404);
  if (act === "dismiss" || act === "undismiss") {
    if (!okId(b.qid)) return json({ ok: false, error: "bad request" }, 400);
    const k = `qa/${id}/${b.qid}`, x: any = await store.get(k, { type: "json" }).catch(() => null);
    const sg = x && Array.isArray(x.suggestions) ? x.suggestions[+b.idx] : null;
    if (!sg) return json({ ok: false, error: "not found" }, 404);
    if (act === "dismiss") { sg.state = "deleted"; sg.by = user; } else delete sg.state;
    await store.setJSON(k, x);
    return json({ ok: true });
  }
  if (act === "comment") {
    const text = String(b.text || "").trim().slice(0, 4000);
    if (!text) return json({ ok: false, error: "empty" }, 400);
    const cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const c = { cid, by: user, at: now, text, section: String(b.section || "General").slice(0, 200), kind: b.kind === "edit" ? "edit" : "comment", parent: okId(b.parent) ? b.parent : null };
    await store.setJSON(`cm/${id}/${cid}`, c);
    return json({ ok: true, comment: c });
  }
  if (act === "resolve" || act === "delcomment") {
    if (!okId(b.cid)) return json({ ok: false, error: "bad request" }, 400);
    const k = `cm/${id}/${b.cid}`, x: any = await store.get(k, { type: "json" }).catch(() => null);
    if (!x) return json({ ok: false, error: "not found" }, 404);
    if (act === "delcomment") await store.delete(k); else { x.resolved = !!b.resolved; x.resolvedBy = user; await store.setJSON(k, x); }
    return json({ ok: true });
  }
  if (act === "review") {
    const st = ["approved", "changes"].includes(b.status) ? b.status : "";
    await store.setJSON(`rv/${id}`, { status: st, by: user, at: now });
    return json({ ok: true });
  }
  if (act === "edit" || act === "restore") {
    if (d.revising && d.revising.status === "running" && Date.now() - Date.parse(d.revising.at) < 10 * 60 * 1000) return json({ ok: false, error: "Changes are being applied right now. Try again in a minute." }, 409);
    let blog: any, note: string, versions: any[];
    if (act === "restore") {
      if (!(d.versions || []).length) return json({ ok: false, error: "Nothing to undo." }, 400);
      const [prev, ...rest] = d.versions; blog = prev.blog; versions = rest; note = `Undid: ${d.revisedNote || "last change"}`;
      await store.setJSON(id, { ...d, blog, words: prev.words || d.words, versions, revisedAt: now, revisedBy: user, revisedNote: prev.note === "Original draft" ? "" : prev.note, revising: null });
      return json({ ok: true, note });
    }
    const p = b.patch || {}, nb: any = { ...d.blog };
    if (typeof p.title === "string" && p.title.trim()) nb.title = p.title.slice(0, 300);
    if (isStrArr(p.intro, 10)) nb.intro = p.intro;
    if (isStrArr(p.keyTakeaways, 12)) nb.keyTakeaways = p.keyTakeaways;
    if (typeof p.cta === "string") nb.cta = p.cta.slice(0, 2000);
    if (Array.isArray(p.sections) && p.sections.length <= 12 && p.sections.every((x: any) => x && typeof x.h2 === "string" && isStrArr(x.paragraphs, 20) && (x.bullets == null || isStrArr(x.bullets, 20)))) nb.sections = p.sections.map((x: any) => ({ h2: x.h2.slice(0, 300), paragraphs: x.paragraphs, bullets: x.bullets || [] }));
    if (Array.isArray(p.faq) && p.faq.length <= 12 && p.faq.every((x: any) => x && typeof x.q === "string" && typeof x.a === "string")) nb.faq = p.faq.map((x: any) => ({ q: x.q.slice(0, 500), a: x.a.slice(0, 3000) }));
    blog = clean(nb);
    blog.schema = { recommendation: d.blog.schema?.recommendation || "Article and FAQPage", jsonld: jsonld(blog) };
    const words = [...(blog.intro || []), ...blog.sections.flatMap((s: any) => [...(s.paragraphs || []), ...(s.bullets || [])])].join(" ").split(/\s+/).length;
    versions = [{ at: d.revisedAt || d.finished, by: d.revisedBy || d.by, note: d.revisedNote || "Original draft", words: d.words, blog: d.blog }, ...(d.versions || [])].slice(0, 10);
    await store.setJSON(id, { ...d, blog, words, versions, revisedAt: now, revisedBy: user, revisedNote: `Text edited by ${user}` });
    return json({ ok: true });
  }
  return json({ ok: false, error: "bad request" }, 400);
}

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "blog-drafts", consistency: "strong" });
  if (req.method === "POST") { try { return await post(req, context, store); } catch { return json({ ok: false, error: "storage unavailable" }, 502); } }
  const u = new URL(req.url), id = u.searchParams.get("id") || "";
  if (!id) { const ix: any = (await store.get("index", { type: "json" }).catch(() => null)) || { items: [] }; return json({ ok: true, items: ix.items }); }
  if (!/^[a-z0-9-]{8,40}$/i.test(id)) return json({ ok: false, error: "bad id" }, 400);
  const d: any = await store.get(id, { type: "json" }).catch(() => null);
  if (!d) return json({ ok: true, draft: { status: "queued" } });
  if (u.searchParams.get("format") === "docx") {
    if (d.status !== "done") return json({ ok: false, error: "not ready" }, 409);
    const buf = await Packer.toBuffer(docx(d.blog));
    const name = (d.blog.slug || "boldt-blog-draft").replace(/[^a-z0-9-]/gi, "").slice(0, 60) || "boldt-blog-draft";
    return new Response(buf, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": `attachment; filename="${name}.docx"`, "cache-control": "no-store" } });
  }
  // Questions asked about this draft ("Ask about this draft") and review comments, oldest first, plus the review status.
  const many = async (prefix: string) => {
    const { blobs } = await store.list({ prefix }).catch(() => ({ blobs: [] as any[] }));
    const out = (await Promise.all(blobs.map((k: any) => store.get(k.key, { type: "json" }).catch(() => null)))).filter(Boolean) as any[];
    return out.sort((x, y) => String(x.at).localeCompare(String(y.at)));
  };
  let qa: any[] = [], comments: any[] = [], review: any = null;
  if (d.status === "done") [qa, comments, review] = await Promise.all([many(`qa/${id}/`), many(`cm/${id}/`), store.get(`rv/${id}`, { type: "json" }).catch(() => null)]);
  const { versions, allowedUrls, ...draft } = d;
  return json({ ok: true, draft: { ...draft, versionCount: (versions || []).length, versions: (versions || []).map((v: any) => ({ at: v.at, by: v.by, note: v.note })) }, qa, comments, review });
};

export const config: Config = { path: "/api/blog", method: ["GET", "POST"] };
