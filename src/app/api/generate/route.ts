import { z } from "zod";
import { cleanHandle, fetchInstagram, isValidHandle } from "@/lib/instagram";
import { looksLikeGibberish } from "@/lib/input";
import { audienceFromFollowers } from "@/lib/pricing";
import { generateStorefront } from "@/lib/prompts";
import { rateLimit } from "@/lib/store";
import { AUDIENCE, LANGUAGES, type InstagramSignals, type Source } from "@/lib/types";
import { aiFailure, clientIp, json } from "@/lib/http";

export const maxDuration = 60;

const Body = z.object({
  handle: z.string().max(200).default(""),
  about: z.string().max(1000).default(""),
  audience: z.enum(AUDIENCE).default("unknown"),
  language: z.enum(LANGUAGES).default("english"),
  avoid: z.array(z.string().max(120)).max(4).optional(),
  skipInstagram: z.boolean().optional(),
});

const IG_MESSAGE: Record<string, string> = {
  invalid: "That doesn't look like an Instagram username. Usernames only use letters, numbers, dots and underscores.",
  not_found: "We couldn't find that Instagram account. Check the spelling, or just tell us about yourself below.",
  private: "Your account is private, so we could only read your bio. Add a line about what you do to get better ideas.",
  unavailable:
    "Instagram isn't letting us read profiles right now. No problem: tell us in a line or two what you do.",
};

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "bad_request", message: "Something went wrong. Please try again." }, 400);
  const b = parsed.data;

  const handle = cleanHandle(b.handle);
  const about = b.about.trim();
  if (!handle && !about)
    return json({ error: "empty", message: "Add your Instagram username or a line about yourself to get started." }, 422);

  if (!(await rateLimit(clientIp(req), "gen", 25, 600)))
    return json({ error: "busy", message: "You've generated a lot in a short time. Take a breather and try again in a few minutes." }, 429);

  // 1. Instagram, best effort
  let ig: InstagramSignals | null = null;
  if (handle) {
    ig = b.skipInstagram
      ? { status: "skipped", handle }
      : isValidHandle(handle)
        ? await fetchInstagram(handle)
        : { status: "invalid", handle };
  }
  const igUseful = !!ig && (ig.status === "found" || ig.status === "private") && !!(ig.biography || ig.captions?.length);

  if (!igUseful && !about) {
    return json(
      {
        error: "need_about",
        igStatus: ig?.status ?? "skipped",
        message: IG_MESSAGE[ig?.status ?? "unavailable"] ?? IG_MESSAGE.unavailable,
      },
      422,
    );
  }

  // 2. Cheap gibberish screen before spending an LLM call
  if (about && !igUseful && looksLikeGibberish(about)) {
    return json(
      {
        error: "unclear",
        message: "We couldn't quite understand that. What do you post about or teach? For example: \"I share easy home workouts for busy moms\".",
      },
      422,
    );
  }

  const audience = b.audience === "unknown" ? audienceFromFollowers(ig?.followers) : b.audience;
  const source: Source = { handle: ig && ig.status !== "invalid" ? handle : "", about, audience, language: b.language };

  try {
    const t0 = Date.now();
    const r = await generateStorefront(source, ig, audience, { avoid: b.avoid });
    if (!r.ok) return json({ error: "unclear", message: r.question }, 422);
    console.log(`[generate] ${r.model} ${Date.now() - t0}ms ig=${ig?.status ?? "none"}`);
    return json({
      storefront: r.storefront,
      assumptions: r.assumptions,
      source,
      instagram: ig
        ? {
            status: ig.status,
            followers: ig.followers ?? null,
            fullName: ig.fullName ?? null,
            usedPosts: ig.captions?.length ?? 0,
            message: ig.status === "found" ? null : IG_MESSAGE[ig.status] ?? null,
          }
        : null,
    });
  } catch (e) {
    return aiFailure(e);
  }
}
