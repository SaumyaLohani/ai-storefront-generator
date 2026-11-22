import { z } from "zod";

export const FORMATS = [
  "ebook",
  "template_pack",
  "recorded_course",
  "cohort_course",
  "one_on_one",
  "webinar",
  "community",
  "personal_plan",
] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_LABEL: Record<Format, string> = {
  ebook: "E-book / Guide",
  template_pack: "Template pack",
  recorded_course: "Recorded course",
  cohort_course: "Live cohort",
  one_on_one: "1:1 call",
  webinar: "Live workshop",
  community: "Community",
  personal_plan: "Personalised plan",
};

export const FORMAT_CTA: Record<Format, string> = {
  ebook: "Get the guide",
  template_pack: "Get the templates",
  recorded_course: "Start learning",
  cohort_course: "Join the cohort",
  one_on_one: "Book a call",
  webinar: "Save my seat",
  community: "Join now",
  personal_plan: "Get my plan",
};

export const LANGUAGES = ["english", "hinglish", "hindi"] as const;
export type Language = (typeof LANGUAGES)[number];

export const THEMES = ["sunrise", "minimal", "midnight"] as const;
export type Theme = (typeof THEMES)[number];

export const AUDIENCE = ["unknown", "starting", "small", "mid", "large"] as const;
export type Audience = (typeof AUDIENCE)[number];
export const AUDIENCE_LABEL: Record<Audience, string> = {
  unknown: "Not sure",
  starting: "Under 5K",
  small: "5K–25K",
  mid: "25K–100K",
  large: "100K+",
};

export const MAX_PRICE = 100000;

export const ProductSchema = z.object({
  id: z.string().min(1).max(24),
  format: z.enum(FORMATS),
  title: z.string().trim().min(1).max(90),
  price: z.number().int().min(0).max(MAX_PRICE),
  priceNote: z.string().max(40).default(""), // e.g. "per month", "per session"
  priceRationale: z.string().max(400).default(""),
  description: z.string().trim().min(1).max(700),
  includes: z.array(z.string().max(120)).max(5).default([]),
  cta: z.string().max(30).default(""),
});
export type Product = z.infer<typeof ProductSchema>;

export const StorefrontSchema = z.object({
  name: z.string().trim().min(1).max(60),
  handle: z.string().max(40).default(""),
  tagline: z.string().max(120).default(""),
  bio: z.string().trim().min(1).max(600),
  niche: z.string().max(60).default(""),
  language: z.enum(LANGUAGES).default("english"),
  theme: z.enum(THEMES).default("sunrise"),
  products: z.array(ProductSchema).min(1).max(4),
});
export type Storefront = z.infer<typeof StorefrontSchema>;

/** What the creator typed, kept so "regenerate all" can re-run with the same inputs. */
export const SourceSchema = z.object({
  handle: z.string().max(40).default(""),
  about: z.string().max(1000).default(""),
  audience: z.enum(AUDIENCE).default("unknown"),
  language: z.enum(LANGUAGES).default("english"),
});
export type Source = z.infer<typeof SourceSchema>;

export type InstagramStatus = "skipped" | "found" | "private" | "not_found" | "unavailable" | "invalid";

export type InstagramSignals = {
  status: InstagramStatus;
  handle: string;
  fullName?: string;
  biography?: string;
  followers?: number;
  category?: string;
  captions?: string[];
};
