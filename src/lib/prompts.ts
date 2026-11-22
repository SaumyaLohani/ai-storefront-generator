import { z } from "zod";
import { customAlphabet } from "nanoid";
import { generateJSON } from "./gemini";
import { PRICE_BANDS, guardPrice, inr } from "./pricing";
import {
  AUDIENCE_LABEL,
  FORMATS,
  FORMAT_CTA,
  type Audience,
  type Format,
  type InstagramSignals,
  type Language,
  type Product,
  type Source,
  type Storefront,
} from "./types";

const pid = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 6);

/* ---------------- shared prompt pieces ---------------- */

const LANGUAGE_RULE: Record<Language, string> = {
  english: "Write all creator-facing copy in simple, warm Indian English. Short sentences. No jargon.",
  hinglish:
    "Write all copy in Hinglish: Hindi and English mixed naturally, in Roman script, the way Indian creators write Instagram captions (e.g. 'Ghar pe hi fit raho, bina gym ke'). Keep product formats and numbers easy to read. Unless the input states the creator's gender, don't guess it: talk to the buyer ('aap seekhenge', 'aapko milega') instead of gendered first-person verbs like 'karti/karta hoon'.",
  hindi:
    "Write ALL copy (tagline, bio, titles, descriptions, every includes point, priceRationale, assumptions) in simple, everyday Hindi in Devanagari script. Never write Hindi in Roman letters. Common English words Indians use daily may appear, but also in Devanagari (कोर्स, प्लान, कॉल), except short forms like PDF. Unless the input states the creator's gender, don't guess it: talk to the buyer ('आप सीखेंगे', 'आपको मिलेगा') instead of first-person verbs like करती/करता हूँ.",
};

/** Wrong-script copy ("Yeh e-book..." on a Hindi page) is rejected and retried. */
function scriptProblem(language: Language, texts: string[]): string | null {
  for (const t of texts) {
    const deva = t.match(/[\u0900-\u097F]/g)?.length ?? 0;
    const letters = t.match(/[\p{L}\p{M}]/gu)?.length ?? 0; // any script: the model once answered in Urdu
    const latin = t.match(/[a-zA-Z]/g)?.length ?? 0;
    if (letters < 8) continue;
    if (language === "hindi" && deva < letters / 2) return "write every field in Hindi using Devanagari script, not Roman letters";
    if (language !== "hindi" && latin < letters * 0.6) return "use Roman (English) letters only, no Devanagari or other script";
  }
  return null;
}
const HE = /[a-z]+(?:ta|raha)\s+(?:hoon|hun|hu|hoo)\b|(?:ता|रहा)\s+(?:हूँ|हूं)/i;
const SHE = /[a-z]+(?:ti|rahi)\s+(?:hoon|hun|hu|hoo)\b|(?:ती|रही)\s+(?:हूँ|हूं)/i;
/** "karta/karti hoon" must match how the creator wrote about themselves; if they didn't say,
 *  the copy shouldn't guess. Asks for a rewrite once only: tone must never fail the request. */
function genderCheck(known: string) {
  const okHe = HE.test(known);
  const okShe = SHE.test(known);
  let asked = false;
  return (text: string): string | null => {
    if (asked || !((HE.test(text) && !okHe) || (SHE.test(text) && !okShe))) return null;
    asked = true;
    return okHe || okShe
      ? `the creator uses the ${okShe ? "feminine" : "masculine"} form for themselves (${okShe ? "'sikhati hoon', 'करती हूँ'" : "'sikhata hoon', 'करता हूँ'"}). Use that form in the bio`
      : "the bio guesses the creator's gender with a first-person verb (like 'karta hoon', 'karti hoon', 'करता हूँ'). Rewrite it without any such verb or slash form, e.g. 'Yahan aapko milega...' or 'Aap seekhenge...'";
  };
}
const CLAIM = new RegExp(
  [
    "\\b(?:thousands|hundreds|lakhs?|millions|dozens) of\\b",
    "\\b(?:have|i've|we've|has) (?:already )?(?:helped|taught|trained|coached|guided|mentored|served)\\b",
    "\\bhelped (?:many|several|countless|numerous|over|more than|hundreds|thousands|\\d)",
    "\\b(?:trusted|loved) by\\b",
    "\\b\\d[\\d,]*\\+?\\s*(?:k\\s*)?(?:happy |satisfied )?(?:students|learners|clients|customers|followers|subscribers|families|women|people)\\b",
    "\\b(?:award[- ]winning|certified|\\d+\\+? years? of)\\b",
    "(?:hazaar|hazaro|hazaron|saikdo|saikdon|lakhon|kaafi|kai|bahut) (?:saare )?(?:students|logon|log|bachon|clients|learners) ki (?:help|madad)",
    "(?:हज़ारों|हजारों|सैकड़ों|लाखों)",
    "(?:मदद की है|सिखाया है|पढ़ाया है)",
  ].join("|"),
  "i",
);
/** Social proof or credentials the creator never gave us. Skipped when their own words make such
 *  a claim. Asks for a rewrite once only, so a false alarm can't fail the request. */
function claimCheck(known: string) {
  const allowed = CLAIM.test(known);
  let asked = false;
  return (texts: string[]): string | null => {
    const hit = !allowed && !asked && texts.map((t) => t.match(CLAIM)?.[0]).find(Boolean);
    if (!hit) return null;
    asked = true;
    return `"${hit}" reads as a claim about the creator's track record that they never gave. Remove invented social proof, numbers of people and credentials`;
  };
}
const productTexts = (p: { description: string; includes: string[] }) => [p.description, p.includes.join(" ")];

const PRICE_GUIDE = Object.entries(PRICE_BANDS)
  .map(([f, b]) => `- ${f}: ${inr(b.min)}–${inr(b.max)}${b.note ? " " + b.note : ""}`)
  .join("\n");

const SYSTEM = `You are the storefront strategist inside SuperProfile, an Indian link-in-bio store used by 2M+ creators to sell courses, digital products, webinars and 1:1 sessions.

Your job: turn what we know about ONE creator into a store they'd be proud to share today. You decide (1) what they should sell, (2) what to charge in INR, (3) the words on the page.

PRODUCT RULES
- Ideas must come from the creator's actual expertise and content. Specific beats generic: "21-Day No-Equipment Fat Loss Plan for Working Women" not "Fitness Course".
- Build a small price ladder: one low-ticket entry product most followers can buy on impulse via UPI (usually under ₹500), then one core product, and optionally one premium/high-touch offer (1:1, cohort) or a community.
- Use different formats across products. Allowed formats: ${FORMATS.join(", ")}.
- Pick formats that fit how THIS niche actually earns. Don't default to template + course + call. Examples: astrology → personal_plan (kundli reading report) and one_on_one; cooking → ebook (recipe book) and webinar (live cook-along); exam prep → community (daily practice group) and recorded_course; fitness → personal_plan (diet/workout plan) or cohort_course (challenge); design/career → template_pack and cohort_course; finance → webinar and ebook.
- Every product must be deliverable by a solo creator next week with a phone and a laptop.

PRICING (India, audience is price-sensitive, prices end in 9 like ₹99/₹499/₹1,999)
Typical bands by format:
${PRICE_GUIDE}
Smaller audiences and beginner niches sit near the bottom of a band; established experts and high-income niches (finance, career, design for professionals) can go higher. priceRationale: one or two plain sentences a first-time creator understands. Make it concrete: tie it to their audience size or niche AND give a familiar anchor the buyer already spends on (e.g. "less than one month of a gym membership", "about the price of a movie ticket", "a fraction of a coaching class fee"). Never invent specific competitor names or fake stats.

WRITING RULES
- Bio: 2–3 sentences, first person, says who they help and how, with one credibility detail if known. Max 350 characters.
- Tagline: max 8 words, no hashtags.
- Product description: 2–3 sentences, speaks to the buyer ("you"), names the outcome, who it's for. includes: 3 short bullet points of what the buyer gets.
- No hype words (revolutionary, ultimate, secret, guaranteed). At most one emoji in the whole bio, none in titles.
- Health, finance, astrology and exam niches: never promise results, cures, returns or ranks.

INPUT QUALITY
- If the input has no real information about a person or skill (gibberish, random characters, a single unrelated word like "hello"), set inputUsable=false, give a friendly followUpQuestion, and still fill the other fields with short placeholders.
- If the input is thin but real (e.g. just "yoga teacher"), set inputUsable=true, make sensible assumptions and list them in assumptions (max 3, short, written to the creator, e.g. "You teach beginners online").
- Never claim facts you weren't given (follower counts, degrees, certifications, years of experience, awards, past results). No invented social proof in any field or language: never say the creator has already helped, taught or been trusted by anyone ("I've helped many students", "join thousands of learners", "मैंने कई छात्रों की मदद की है") unless the input says so. Say what the creator does or what the buyer will get instead.
- name: use the creator's real name or brand only if it appears in the input. Otherwise NEVER put any human first name or surname in the store name, bio or titles (no "Priya", "Sanchit", "Acharya Sharma"); create a short brand-style store name from their niche (e.g. "20-Min Fit Club", "Tiffin Tales Kitchen") and add an assumption like "We named your store '20-Min Fit Club'. Change it to your own name or brand."`;

function creatorContext(src: Source, ig: InstagramSignals | null, audience: Audience) {
  const lines: string[] = [];
  if (src.handle) lines.push(`Instagram handle: @${src.handle}`);
  if (ig && (ig.status === "found" || ig.status === "private")) {
    if (ig.fullName) lines.push(`Name on Instagram: ${ig.fullName}`);
    if (ig.category) lines.push(`Instagram category: ${ig.category}`);
    if (ig.followers != null) lines.push(`Followers: ${ig.followers.toLocaleString("en-IN")}`);
    if (ig.biography) lines.push(`Instagram bio: """${ig.biography}"""`);
    if (ig.captions?.length)
      lines.push(`Recent post captions:\n${ig.captions.map((c) => `- """${c.replace(/\s+/g, " ")}"""`).join("\n")}`);
  }
  if (src.about) lines.push(`In their own words: """${src.about}"""`);
  lines.push(`Audience size: ${AUDIENCE_LABEL[audience]}`);
  return lines.join("\n");
}

/* ---------------- schemas ---------------- */

const productSchemaProps = {
  format: { type: "STRING", enum: [...FORMATS] },
  title: { type: "STRING" },
  price: { type: "INTEGER" },
  priceRationale: { type: "STRING" },
  description: { type: "STRING" },
  includes: { type: "ARRAY", items: { type: "STRING" }, minItems: 2, maxItems: 4 },
};
const productSchema = {
  type: "OBJECT",
  properties: productSchemaProps,
  required: ["format", "title", "price", "priceRationale", "description", "includes"],
  propertyOrdering: ["format", "title", "price", "priceRationale", "description", "includes"],
};

const RawProduct = z.object({
  format: z.enum(FORMATS),
  title: z.string().min(3).max(120),
  price: z.number(),
  priceRationale: z.string().min(5).max(500),
  description: z.string().min(20).max(900),
  includes: z.array(z.string().min(2).max(160)).min(1).max(5),
});
type RawProduct = z.infer<typeof RawProduct>;

// When the input is unusable the other fields are throwaway placeholders, so don't validate them.
const RawStore = z.discriminatedUnion("inputUsable", [
  z.object({ inputUsable: z.literal(false), followUpQuestion: z.string().default("") }),
  z.object({
    inputUsable: z.literal(true),
    name: z.string().min(1).max(120),
    tagline: z.string().max(240),
    bio: z.string().min(10).max(1000),
    niche: z.string().max(160),
    assumptions: z.array(z.string().max(300)).max(6).default([]),
    products: z.array(RawProduct).min(1).max(4),
  }),
]);

const storeSchema = {
  type: "OBJECT",
  properties: {
    inputUsable: { type: "BOOLEAN" },
    followUpQuestion: { type: "STRING" },
    name: { type: "STRING" },
    niche: { type: "STRING" },
    tagline: { type: "STRING" },
    bio: { type: "STRING" },
    assumptions: { type: "ARRAY", items: { type: "STRING" }, maxItems: 3 },
    products: { type: "ARRAY", items: productSchema, minItems: 2, maxItems: 4 },
  },
  required: ["inputUsable", "followUpQuestion", "name", "niche", "tagline", "bio", "assumptions", "products"],
  propertyOrdering: ["inputUsable", "followUpQuestion", "name", "niche", "tagline", "bio", "assumptions", "products"],
};

/* ---------------- post-processing ---------------- */

function finishProduct(p: RawProduct, audience: Audience, id = pid()): Product {
  const g = guardPrice(p.format as Format, Math.round(p.price), audience);
  let rationale = p.priceRationale.trim();
  if (g.adjusted) rationale += ` (Adjusted to ${inr(g.price)} to stay in the usual range for this format.)`;
  return {
    id,
    format: p.format,
    title: p.title.trim().slice(0, 90),
    price: g.price,
    priceNote: g.note,
    priceRationale: rationale.slice(0, 400),
    description: p.description.trim().slice(0, 700),
    includes: p.includes.map((s) => s.trim().slice(0, 120)).slice(0, 4),
    cta: FORMAT_CTA[p.format],
  };
}

function storeCheck(s: z.infer<typeof RawStore>): string | null {
  if (!s.inputUsable) return null;
  if (s.products.length < 2) return "give at least 2 products";
  const formats = new Set(s.products.map((p) => p.format));
  if (formats.size < Math.min(2, s.products.length)) return "use different formats across products";
  const titles = new Set(s.products.map((p) => p.title.toLowerCase()));
  if (titles.size !== s.products.length) return "product titles must be distinct";
  if (!s.products.some((p) => p.price <= 999)) return "include one entry product priced under ₹1,000";
  return null;
}

/* ---------------- public API ---------------- */

export type GenerateResult =
  | { ok: true; storefront: Storefront; assumptions: string[]; model: string }
  | { ok: false; reason: "unclear"; question: string };

export async function generateStorefront(
  src: Source,
  ig: InstagramSignals | null,
  audience: Audience,
  opts: { avoid?: string[]; keepName?: string } = {},
): Promise<GenerateResult> {
  const avoid = opts.avoid?.length
    ? `\n\nThe creator asked for fresh ideas. Do NOT repeat these previous products, try different angles: ${opts.avoid.join(" | ")}`
    : "";
  const keep = opts.keepName
    ? `\n\nThe store is already called "${opts.keepName}". Use exactly that name and do not list the name as an assumption.`
    : "";
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const known = `${src.about} ${ig?.biography ?? ""}`;
  const gender = genderCheck(known);
  const claims = claimCheck(known);
  const prompt = `TODAY: ${today} (use the current or next year if a product is dated)\n\nCREATOR\n${creatorContext(src, ig, audience)}\n\nLANGUAGE\n${LANGUAGE_RULE[src.language]}\n\nCreate their storefront with 3 products (2 if the input is very thin, 4 only if they clearly have a large range).${avoid}${keep}`;

  const { data, model } = await generateJSON({
    system: SYSTEM,
    prompt,
    schema: storeSchema,
    validate: RawStore,
    check: (d) =>
      storeCheck(d) ??
      (d.inputUsable ? claims([d.bio, d.tagline, ...d.products.map((p) => p.description)]) : null) ??
      (d.inputUsable ? gender(d.bio) : null) ?? (d.inputUsable ? scriptProblem(src.language, [d.bio, ...d.products.flatMap(productTexts)]) : null),
    temperature: opts.avoid?.length ? 1.0 : 0.85,
  });

  if (!data.inputUsable) {
    return {
      ok: false,
      reason: "unclear",
      question: data.followUpQuestion || "Tell us a bit more: what do you teach or post about, and who follows you?",
    };
  }

  const storefront: Storefront = {
    name: (opts.keepName || ig?.fullName || data.name).trim().slice(0, 60),
    handle: src.handle,
    tagline: data.tagline.trim().slice(0, 120),
    bio: data.bio.trim().slice(0, 600),
    niche: data.niche.trim().slice(0, 60),
    language: src.language,
    theme: "sunrise",
    products: data.products.slice(0, 4).map((p) => finishProduct(p, audience)),
  };
  return { ok: true, storefront, assumptions: data.assumptions.slice(0, 3), model };
}

export type Part =
  | { kind: "bio" }
  | { kind: "product"; index: number } // brand new idea in that slot
  | { kind: "product_copy"; index: number } // rewrite words, keep format & price
  | { kind: "add_product" }
  | { kind: "translate"; language: Language }; // same store, same prices, new language

function storeSummary(s: Storefront) {
  return [
    `Name: ${s.name}${s.handle ? ` (@${s.handle})` : ""}`,
    `Niche: ${s.niche}`,
    `Tagline: ${s.tagline}`,
    `Bio: ${s.bio}`,
    `Products:`,
    ...s.products.map((p, i) => `  ${i + 1}. [${p.format}] ${p.title} — ${inr(p.price)} ${p.priceNote}`),
  ].join("\n");
}

const BioOut = z.object({ tagline: z.string().max(160), bio: z.string().min(10).max(700) });
const bioSchema = {
  type: "OBJECT",
  properties: { tagline: { type: "STRING" }, bio: { type: "STRING" } },
  required: ["tagline", "bio"],
};

const TranslateOut = z.object({
  tagline: z.string().max(240),
  bio: z.string().min(5).max(1000),
  products: z.array(
    z.object({
      title: z.string().min(2).max(160),
      priceRationale: z.string().max(600).default(""),
      description: z.string().min(5).max(1100),
      includes: z.array(z.string().max(200)).max(6),
    }),
  ),
});
const translateSchema = {
  type: "OBJECT",
  properties: {
    tagline: { type: "STRING" },
    bio: { type: "STRING" },
    products: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          priceRationale: { type: "STRING" },
          description: { type: "STRING" },
          includes: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["title", "priceRationale", "description", "includes"],
      },
    },
  },
  required: ["tagline", "bio", "products"],
};

async function translateStore(store: Storefront, src: Source, language: Language): Promise<Partial<Storefront>> {
  const gender = genderCheck(src.about);
  const copy = {
    tagline: store.tagline,
    bio: store.bio,
    products: store.products.map((p) => ({
      title: p.title,
      priceRationale: p.priceRationale,
      description: p.description,
      includes: p.includes.filter((x) => x.trim()),
    })),
  };
  const { data } = await generateJSON({
    system: SYSTEM,
    prompt: `CURRENT STORE COPY (JSON)\n${JSON.stringify(copy)}\n\nLANGUAGE\n${LANGUAGE_RULE[language]}\n\nTASK: Rewrite all of this copy, including the product titles, in the language above. Keep the same meaning, the same products in the same order, the same number of includes per product, and every number and rupee amount unchanged. Keep the store name "${store.name}" as it is wherever it appears. If a field is empty, return it empty. Return JSON in the same shape.`,
    schema: translateSchema,
    validate: TranslateOut,
    check: (d) =>
      d.products.length !== store.products.length
        ? `return exactly ${store.products.length} products`
        : d.products.some((p, i) => p.includes.length !== copy.products[i].includes.length)
          ? "keep the same number of includes for each product"
          : (scriptProblem(language, [d.bio, ...d.products.flatMap(productTexts)]) ?? gender(d.bio)),
    temperature: 0.6,
  });
  return {
    language,
    tagline: store.tagline.trim() ? data.tagline.trim().slice(0, 120) : "",
    bio: data.bio.trim().slice(0, 600),
    products: store.products.map((p, i) => ({
      ...p,
      title: data.products[i].title.trim().slice(0, 90),
      priceRationale: p.priceRationale ? data.products[i].priceRationale.trim().slice(0, 400) : "",
      description: data.products[i].description.trim().slice(0, 700),
      includes: data.products[i].includes.map((s) => s.trim().slice(0, 120)),
    })),
  };
}

export async function regeneratePart(
  store: Storefront,
  src: Source,
  part: Part,
  instruction: string,
  audience: Audience,
): Promise<Partial<Storefront> & { product?: Product }> {
  if (part.kind === "translate") return translateStore(store, src, part.language);

  const today = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const ctx = `TODAY: ${today}\n\nCREATOR (original input)\n${creatorContext(src, null, audience)}\n\nCURRENT STORE (the creator may have edited it; respect their edits)\n${storeSummary(store)}\n\nLANGUAGE\n${LANGUAGE_RULE[store.language]}`;
  // the creator may have typed a real claim into the page or the instruction: respect it
  const claims = claimCheck([src.about, store.bio, instruction, ...store.products.map((p) => p.description)].join(" "));
  const ask = instruction ? `\nThe creator's instruction: "${instruction.slice(0, 200)}"` : "";

  if (part.kind === "bio") {
    const gender = genderCheck(src.about);
    const { data } = await generateJSON({
      system: SYSTEM,
      prompt: `${ctx}\n\nTASK: Write a NEW tagline and bio for this store, different from the current one.${ask}`,
      schema: bioSchema,
      validate: BioOut,
      check: (d) => scriptProblem(store.language, [d.bio]) ?? claims([d.bio, d.tagline]) ?? gender(d.bio),
      temperature: 1,
    });
    return { tagline: data.tagline.trim().slice(0, 120), bio: data.bio.trim().slice(0, 600) };
  }

  if (part.kind === "product_copy") {
    const cur = store.products[part.index];
    const { data } = await generateJSON({
      system: SYSTEM,
      prompt: `${ctx}\n\nTASK: Rewrite the title, description and includes of product ${part.index + 1} ("${cur.title}"). Keep format "${cur.format}" and price ${cur.price}. Make it clearer and more convincing than the current copy.\nCurrent description: ${cur.description}${ask}`,
      schema: productSchema,
      validate: RawProduct,
      check: (p) => scriptProblem(store.language, productTexts(p)) ?? claims([p.description]),
      temperature: 1,
    });
    return {
      product: {
        ...cur,
        title: data.title.trim().slice(0, 90),
        description: data.description.trim().slice(0, 700),
        includes: data.includes.map((s) => s.trim().slice(0, 120)).slice(0, 4),
      },
    };
  }

  const others = store.products.filter((_, i) => part.kind !== "product" || i !== part.index);
  const taken = others.map((p) => p.format).join(", ");
  const target =
    part.kind === "product"
      ? `Replace product ${part.index + 1} ("${store.products[part.index].title}") with a DIFFERENT product idea.`
      : `Suggest ONE more product that fills a gap in this store.`;
  const { data } = await generateJSON({
    system: SYSTEM,
    prompt: `${ctx}\n\nTASK: ${target} Prefer a format not already used (${taken || "none"}). It must not duplicate any existing product.${ask}`,
    schema: productSchema,
    validate: RawProduct,
    check: (p) =>
      others.some((o) => o.title.toLowerCase() === p.title.toLowerCase()) ? "duplicate of an existing product" : (scriptProblem(store.language, productTexts(p)) ?? claims([p.description])),
    temperature: 1,
  });
  const keepId = part.kind === "product" ? store.products[part.index].id : undefined;
  return { product: finishProduct(data, audience, keepId) };
}
