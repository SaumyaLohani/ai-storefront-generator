import { canEdit, getStats, getStore } from "@/lib/store";
import { json } from "@/lib/http";

/** Owner-only: load a published store for editing (e.g. on another device) plus its stats. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const slug = u.searchParams.get("slug") || "";
  const key = u.searchParams.get("key") || "";
  try {
    if (!(await canEdit(slug, key))) return json({ error: "forbidden" }, 403);
    const s = await getStore(slug);
    const stats = await getStats(slug);
    let clicks = 0;
    const byProduct: Record<string, number> = {};
    for (const [k, v] of Object.entries(stats)) {
      if (k.startsWith("click:")) {
        clicks += v;
        byProduct[k.slice(6)] = v;
      }
    }
    return json({ storefront: s!.storefront, source: s!.source, stats: { views: stats.views ?? 0, clicks, byProduct } });
  } catch (e) {
    console.error("[store]", e);
    return json({ error: "unavailable" }, 503);
  }
}
