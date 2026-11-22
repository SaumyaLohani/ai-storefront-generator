import { getStore, track } from "@/lib/store";

/** Views and clicks on public pages, sent with navigator.sendBeacon (text/plain body). */
export async function POST(req: Request) {
  try {
    const body = JSON.parse(await req.text());
    const slug = String(body.slug || "");
    const event = body.event === "click" ? "click" : "view";
    const pid = String(body.productId || "").replace(/[^a-z0-9]/g, "").slice(0, 12);
    const store = await getStore(slug);
    if (!store) return new Response(null, { status: 204 });
    if (event === "view") await track(slug, "views");
    else if (store.storefront.products.some((p) => p.id === pid)) await track(slug, `click:${pid}`);
  } catch {
    /* analytics must never break the page */
  }
  return new Response(null, { status: 204 });
}
