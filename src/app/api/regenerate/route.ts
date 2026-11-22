import { z } from "zod";
import { regeneratePart, type Part } from "@/lib/prompts";
import { rateLimit } from "@/lib/store";
import { LANGUAGES, SourceSchema, StorefrontSchema } from "@/lib/types";
import { aiFailure, clientIp, json } from "@/lib/http";

export const maxDuration = 60;

const Body = z.object({
  storefront: StorefrontSchema,
  source: SourceSchema,
  part: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("bio") }),
    z.object({ kind: z.literal("product"), index: z.number().int().min(0).max(3) }),
    z.object({ kind: z.literal("product_copy"), index: z.number().int().min(0).max(3) }),
    z.object({ kind: z.literal("add_product") }),
    z.object({ kind: z.literal("translate"), language: z.enum(LANGUAGES) }),
  ]),
  instruction: z.string().max(200).default(""),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    console.error("[regenerate] bad body", parsed.error.issues.slice(0, 3));
    return json(
      { error: "bad_request", message: "Some fields are empty or too long. Fix the highlighted fields and try again." },
      400,
    );
  }
  const { storefront, source, part, instruction } = parsed.data;
  if ("index" in part && part.index >= storefront.products.length)
    return json({ error: "bad_request", message: "That product no longer exists." }, 400);
  if (part.kind === "add_product" && storefront.products.length >= 4)
    return json({ error: "bad_request", message: "A store can have up to 4 products." }, 400);

  if (!(await rateLimit(clientIp(req), "regen", 60, 600)))
    return json({ error: "busy", message: "Slow down a little. Try again in a few minutes." }, 429);

  try {
    const patch = await regeneratePart(storefront, source, part as Part, instruction, source.audience);
    return json({ patch });
  } catch (e) {
    return aiFailure(e);
  }
}
