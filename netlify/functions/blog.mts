import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { Document, Packer, Paragraph, HeadingLevel, TextRun, ExternalHyperlink } from "docx";

// Generate Blog drafts (written by blog-run-background).
// GET /api/blog                 -> { ok, items: [{ id, title, by, created, words }] }   recent drafts
// GET /api/blog?id=<id>         -> { ok, draft: { status: running | done | failed, blog?, ... } }
// GET /api/blog?id=<id>&format=docx -> the draft as a Word document
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
  if (b.whyThisTopic) { c.push(H("Why this topic", HeadingLevel.HEADING_2)); c.push(P(b.whyThisTopic)); }
  return new Document({ creator: "Boldt Marketing Dashboard", title: b.title, styles: { default: { document: { run: { font: "Calibri", size: 22 } } } }, sections: [{ children: c }] });
}

export default async (req: Request) => {
  const store = getStore({ name: "blog-drafts", consistency: "strong" });
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
  return json({ ok: true, draft: d });
};

export const config: Config = { path: "/api/blog", method: ["GET"] };
