/**
 * Cheap pre-checks before we spend an LLM call. Returns a reason when the text
 * clearly carries no meaning ("asdfgh", "....", "aaaaaa"). Anything borderline
 * goes to the model, which can also say the input is unusable.
 */
export function looksLikeGibberish(text: string): string | null {
  const t = text.trim();
  if (!t) return "empty";
  // Devanagari or other non-Latin scripts: only check length and repetition
  const latin = t.replace(/[^a-zA-Z]/g, "");
  const letters = t.replace(/[\s\d\p{P}\p{S}]/gu, "");
  if (letters.length < 3) return "too_short";
  // Only letters count as mashing: "cakes!!!!!", "yoga..." and "100000 followers" are real input.
  const sensible = t.split(/\s+/).filter((w) => !/(\p{L})\1{4,}/iu.test(w)).join("").replace(/[\s\d\p{P}\p{S}]/gu, "");
  if (sensible.length < 3) return "repeated";
  const distinct = new Set(letters.toLowerCase()).size;
  if (distinct === 1 || (distinct === 2 && letters.length > 4)) return "repeated"; // keeps "MMA", "PHP"
  if (latin.length >= 5 && latin.length / letters.length > 0.8) {
    const words = t.toLowerCase().match(/[a-z]+/g) ?? [];
    const longWords = words.filter((w) => w.length >= 4);
    if (longWords.length) {
      // words with no vowels (incl. y) or long consonant runs, like "sdfghjk"
      const bad = longWords.filter((w) => (w.length >= 5 && !/[aeiouy]/.test(w)) || /[^aeiouy]{5,}/.test(w));
      if (bad.length / longWords.length > 0.5) return "no_words";
      // keyboard mash
      if (longWords.some((w) => /qwert|asdf|zxcv|hjkl|uiop/.test(w)) && words.length <= 3) return "no_words";
    }
  }
  return null;
}

export function wordCount(text: string) {
  return (text.trim().match(/\S+/g) ?? []).length;
}
