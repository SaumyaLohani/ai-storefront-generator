import { z } from "zod";
import { createStore, rateLimit, updateStore } from "@/lib/store";
import { SourceSchema, StorefrontSchema } from "@/lib/types";
import { clientIp, json } from "@/lib/http";

const Body = z.object({
  storefront: StorefrontSchema,
  source: SourceSchema,
  slug: z.string().max(40).optional(),
  editKey: z.string().max(64).optional(),
}).refine((b) => new Set(b.storefront.products.map((p) => p.id)).size === b.storefront.products.length);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return json(
      { error: "invalid", path: first?.path, message: "Some fields are empty or too long. Fix the highlighted fields and try again." },
      400,
    );
  }
  const { storefront, source, slug, editKey } = parsed.data;

  try {
    if (slug && editKey) {
      const r = await updateStore(slug, editKey, storefront, source);
      if (r === "ok") return json({ slug, editKey, updated: true });
      // stale or foreign key: fall through and publish as a new store instead of failing
    }
    if (!(await rateLimit(clientIp(req), "pub", 30, 3600)))
      return json({ error: "busy", message: "Too many new stores from this device. Try again later." }, 429);
    const r = await createStore(storefront, source);
    return json({ ...r, updated: false });
  } catch (e) {
    console.error("[publish]", e);
    return json({ error: "save_failed", message: "We couldn't save your store just now. Your edits are safe on this phone, so try again." }, 503);
  }
}
