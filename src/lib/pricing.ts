import type { Audience, Format } from "./types";

/**
 * Guard-rails on what the model proposes. Bands are what Indian micro-creators
 * typically charge for each format (one-time INR unless noted). The model picks
 * inside the band; we only step in when it drifts outside.
 */
export const PRICE_BANDS: Record<Format, { min: number; max: number; note: string }> = {
  ebook: { min: 49, max: 799, note: "" },
  template_pack: { min: 99, max: 1499, note: "" },
  recorded_course: { min: 299, max: 4999, note: "" },
  cohort_course: { min: 999, max: 14999, note: "" },
  one_on_one: { min: 299, max: 4999, note: "per session" },
  webinar: { min: 49, max: 999, note: "" },
  community: { min: 99, max: 999, note: "per month" },
  personal_plan: { min: 299, max: 4999, note: "" },
};

/** Larger audiences can charge more; tiny ones should stay near the bottom of the band. */
const AUDIENCE_CEILING: Record<Audience, number> = {
  starting: 0.45,
  small: 0.65,
  unknown: 0.75,
  mid: 0.9,
  large: 1,
};

const CHARM = [
  49, 99, 149, 199, 249, 299, 349, 399, 449, 499, 599, 699, 799, 899, 999, 1199, 1299, 1499, 1799,
  1999, 2499, 2999, 3499, 3999, 4499, 4999, 5999, 6999, 7999, 8999, 9999, 11999, 12999, 14999,
];

/** Snap to the closest "₹x99"-style price Indians are used to seeing. */
export function charm(price: number): number {
  let best = CHARM[0];
  for (const c of CHARM) if (Math.abs(c - price) < Math.abs(best - price)) best = c;
  return best;
}

export function guardPrice(format: Format, price: number, audience: Audience) {
  const band = PRICE_BANDS[format];
  const ceiling = Math.max(band.min, band.max * AUDIENCE_CEILING[audience]);
  let p = Number.isFinite(price) ? price : band.min;
  let adjusted = false;
  if (p < band.min) {
    p = band.min;
    adjusted = true;
  } else if (p > ceiling) {
    p = ceiling;
    adjusted = true;
  }
  const snapped = charm(p);
  // snapping can push us just outside the band; pull back in
  const final = Math.min(Math.max(snapped, band.min), Math.max(band.min, charmFloor(ceiling)));
  return { price: final, adjusted, note: band.note };
}

function charmFloor(n: number) {
  let best = CHARM[0];
  for (const c of CHARM) if (c <= n) best = c;
  return best;
}

export function audienceFromFollowers(n?: number): Audience {
  if (n == null) return "unknown";
  if (n < 5000) return "starting";
  if (n < 25000) return "small";
  if (n < 100000) return "mid";
  return "large";
}

export const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
