# Store in a Minute

An AI storefront generator for Indian creators. Type your Instagram username or one line about what you do, and in about 10 seconds you get a store page: a bio, 2–4 digital products with formats and INR prices, and a mobile page you can share on WhatsApp.

- **Live app:** https://ai-storefront-generator-chi.vercel.app
- **Decision doc:** _add link_
- **Demo video:** _add Loom link_

## What it does

1. **Input.** An Instagram username (optional), a sentence about what you post or teach, rough audience size and language (English, Hinglish or Hindi). Messy input is fine.
2. **Generate.** The AI writes a store name, tagline and bio, and picks 2–4 products that suit the niche. They form a price ladder, from a cheap entry product to one premium product. Each product has a format (e-book, template pack, recorded course, cohort, 1:1 call, workshop, community, personalised plan), a price in rupees, a description, what's included, and a short reason for the price.
3. **Edit on the page itself.** The editor looks exactly like the final page. Tap any text to change it. Use ✨ to let AI rewrite one part (the bio, one product's words, or a different product idea) with quick instructions like "Shorter" or "Cheaper". You can also add a product, switch language, change theme and undo.
4. **Publish and share.** You get a public link at `/s/<slug>`, WhatsApp share, a private edit link, and basic stats (views and button taps per product).

## How the AI part works

All calls go to Google Gemini through its REST API, with no mocks. The code is in `src/lib/gemini.ts` and `src/lib/prompts.ts`.

- **Structured output.** Every call asks for JSON matching a schema. The answer is then validated with zod plus business rules: 2–4 products, at least two different formats, distinct titles, and one entry product under ₹1,000.
- **Self-repair.** If validation fails, the model is asked again once, and told exactly what was wrong.
- **Fallback chain.** `gemini-3.5-flash-lite` → `3.1-flash-lite` → `flash-lite-latest` → `3-flash-preview`. If a model is busy (503/429) or slow, the next one is tried. If all are busy, the app waits 1.5 seconds and goes round once more. The whole job must finish within 45 seconds.
- **Price guard-rails.** `src/lib/pricing.ts` sets a price band per format. The ceiling scales with audience size: a creator with under 5K followers won't be told to sell a ₹15,000 cohort. Prices are rounded to familiar "₹x99" amounts. The model's price is a suggestion, and the code has the final say.
- **Messy input.**
  - Empty input or keyboard mashing is caught *before* any AI call, so it costs nothing.
  - Vague input ("hello") makes the model reply `inputUsable=false` with one follow-up question, and the app shows that question instead of a made-up store.
  - Thin input ("fitness") still gets a store, and the app shows the guesses it made so the creator can correct them.
- **Writing rules.**
  - No invented human names.
  - No hype words.
  - No promised results in health, money, astrology or exam niches.
  - Hinglish is written in Roman script, Hindi in Devanagari.
- **Instagram.** This is a best-effort fetch of the public profile: name, bio, follower count and recent captions. Private, missing or blocked profiles fall back to the description, with a clear message telling the creator what happened. In practice Instagram blocks most requests from cloud servers such as Vercel, so on the live site the description is usually what drives generation. A production version would use the Instagram Graph API with the creator's login.

## Run it locally

Needs Node 20+.

```bash
npm install
cp .env.example .env.local   # then add your GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

| Variable | Required | What it does |
|---|---|---|
| `GEMINI_API_KEY` | yes | Free key from Google AI Studio |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | for deploys | Upstash Redis (added automatically by the Vercel Upstash integration). Without them, stores live in memory and vanish on restart. |
| `GEMINI_MODELS` | no | Comma-separated model chain to override the default |

Keys are only read on the server and are never committed (`.env*` is git-ignored).

## Deploy

1. Push to GitHub and import the repo in Vercel.
2. Add `GEMINI_API_KEY` in Project → Settings → Environment Variables.
3. Add the Upstash Redis integration from the Vercel Marketplace, which sets the `KV_*` variables.
4. Redeploy.

## Code map

```
src/
  app/
    page.tsx, Builder.tsx      input → loading → inline editor, publish/share sheets
    s/[slug]/                  public store page (server-rendered, OG tags, view/click beacons)
    api/generate               input checks → Instagram → AI storefront
    api/regenerate             AI rewrite of one part (bio, product, product copy, add product)
    api/publish                create store, or update it with the private edit key
    api/track, api/store       view/click counters; owner-only stats
  components/StoreView.tsx     one component for editor and public page (what you edit is what buyers see)
  lib/
    gemini.ts                  schema calls, validation, retry, model fallback
    prompts.ts                 system prompt, storefront + part-regeneration prompts
    pricing.ts                 price bands, audience ceilings, ₹x99 rounding
    input.ts                   gibberish / too-short detection
    instagram.ts               public profile fetch with status mapping
    store.ts                   Upstash Redis (or in-memory) storage, edit keys, rate limits, stats
```

## Abuse and safety basics

- Per-IP rate limits apply on generate, regenerate and publish.
- Edit keys are stored only as SHA-256 hashes.
- Slugs are checked against a strict pattern.
- Checkout is switched off in this demo: the buy button explains that real SuperProfile stores open UPI and card payment.

## How AI coding tools were used

I built this with Claude Code as a pair programmer. I owned the product decisions: scope, the inline editor over a form wizard, price guard-rails, how messy input is handled, and copy tone. Claude Code wrote most of the code to those specs. I tested the flows on mobile, checked the AI output across niches and languages, and fed the issues back as prompt and code changes, for example invented creator names, stale years in product titles, and model outages.
