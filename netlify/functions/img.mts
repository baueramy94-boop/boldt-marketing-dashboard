import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// LinkedIn ad images. LinkedIn's image links expire about a week after each data pull, so the first time an ad's image
// is requested this function looks up a fresh link through Windsor.ai, downloads the image and keeps a permanent copy.
// After that the saved copy is served. The edge gate has already checked the site password.

const notFound = () => new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
const ID = /^\d{3,20}$/;

async function freshLinks(key: string): Promise<Record<string, string>> {
  const meta = getStore({ name: "creative-meta" });
  const cached: any = await meta.get("links", { type: "json" });
  if (cached && Date.now() - cached.t < 6 * 3600 * 1000) return cached.links;
  const today = new Date().toISOString().slice(0, 10);
  const u = new URL(`${Netlify.env.get("WINDSOR_BASE") || "https://connectors.windsor.ai"}/linkedin`);
  u.searchParams.set("api_key", key);
  u.searchParams.set("fields", "creative_id,creative_thumbnail");
  u.searchParams.set("date_from", "2024-11-01");
  u.searchParams.set("date_to", today);
  const r = await fetch(u);
  if (!r.ok) return cached ? cached.links : {};
  const rows: any[] = (await r.json()).data || [];
  const links: Record<string, string> = {};
  for (const x of rows) if (x.creative_id && x.creative_thumbnail) links[String(x.creative_id)] = String(x.creative_thumbnail);
  await meta.setJSON("links", { t: Date.now(), links });
  return links;
}

export default async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!ID.test(id)) return notFound();
  const imgs = getStore({ name: "creative-images" });
  try {
    const saved = await imgs.getWithMetadata(id, { type: "arrayBuffer" });
    if (saved && saved.data) {
      return new Response(saved.data, { headers: { "content-type": String(saved.metadata?.type || "image/png"), "cache-control": "private, max-age=604800" } });
    }
    const key = Netlify.env.get("WINDSOR_API_KEY");
    if (!key) return notFound();
    const link = (await freshLinks(key))[id];
    if (!link || !/^https:\/\/media\.licdn\.com\//.test(link)) return notFound();
    const r = await fetch(link);
    if (!r.ok) return notFound();
    const type = r.headers.get("content-type") || "image/png";
    if (!/^image\//.test(type)) return notFound();
    const buf = await r.arrayBuffer();
    await imgs.set(id, buf, { metadata: { type, savedAt: new Date().toISOString() } });
    return new Response(buf, { headers: { "content-type": type, "cache-control": "private, max-age=604800" } });
  } catch (err) {
    return notFound();
  }
};

export const config: Config = { path: "/api/img", method: ["GET"] };
