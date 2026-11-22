"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { FORMATS, FORMAT_CTA, FORMAT_LABEL, MAX_PRICE, type Format, type Product, type Storefront } from "@/lib/types";
import { PRICE_BANDS, inr } from "@/lib/pricing";

/* ---------- inline-editable text ---------- */

function AutoText({
  value,
  onChange,
  className = "",
  placeholder,
  maxLength,
  invalid,
  label,
  single,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  invalid?: boolean;
  label: string;
  single?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  // re-fit when the width changes (rotate, resize) or the web font arrives
  useEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    };
    window.addEventListener("resize", fit);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={`ed ${className}`}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(single ? e.target.value.replace(/\n/g, " ") : e.target.value)}
      onKeyDown={(e) => {
        if (single && e.key === "Enter") e.preventDefault();
      }}
    />
  );
}

function initials(name: string) {
  // first letter or digit of the first two words; skips emoji and symbols
  const firsts = name.split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0]).filter(Boolean);
  return firsts.slice(0, 2).join("").toUpperCase() || "★";
}

/* ---------- the store page ---------- */

type Props = {
  store: Storefront;
  editable?: boolean;
  onChange?: (s: Storefront) => void;
  bioTools?: ReactNode;
  bioBusy?: string | false;
  productTools?: (index: number) => ReactNode;
  productBusy?: (index: number) => string | null;
  afterProducts?: ReactNode;
  onCta?: (p: Product) => void;
  footer?: ReactNode;
  showErrors?: boolean;
};

export default function StoreView({
  store,
  editable,
  onChange,
  bioTools,
  bioBusy,
  productTools,
  productBusy,
  afterProducts,
  onCta,
  footer,
  showErrors,
}: Props) {
  const set = (patch: Partial<Storefront>) => onChange?.({ ...store, ...patch });
  const setP = (i: number, patch: Partial<Product>) =>
    set({ products: store.products.map((p, j) => (i === j ? { ...p, ...patch } : p)) });

  return (
    <div className="sf min-h-full" data-theme={store.theme}>
      <header className="sf-hero px-5 pt-10 pb-6 text-center">
        <div
          className="sf-avatar mx-auto flex h-20 w-20 items-center justify-center rounded-full text-2xl font-extrabold shadow-sm"
          aria-hidden
        >
          {initials(store.name)}
        </div>
        <div className="relative mx-auto mt-4 max-w-md">
          {bioBusy && (
            <div className="busy-veil">
              <span className="spin" /> {bioBusy}
            </div>
          )}
          {editable ? (
            <>
              <AutoText
                label="Your name"
                single
                className="text-center text-2xl font-extrabold leading-tight"
                value={store.name}
                maxLength={60}
                placeholder="Your name"
                invalid={showErrors && !store.name.trim()}
                onChange={(v) => set({ name: v })}
              />
              <AutoText
                label="Tagline"
                single
                className="sf-muted mt-1 text-center text-[15px] font-semibold"
                value={store.tagline}
                maxLength={120}
                placeholder="A short line about what you do"
                onChange={(v) => set({ tagline: v })}
              />
            </>
          ) : (
            <>
              <h1 className="text-2xl font-extrabold leading-tight">{store.name}</h1>
              {store.tagline && <p className="sf-muted mt-1 text-[15px] font-semibold">{store.tagline}</p>}
            </>
          )}
          {editable && (
            <label className="sf-muted mt-2 flex items-center justify-center text-sm font-medium">
              @
              <input
                aria-label="Instagram username"
                className="ed"
                style={{ width: "auto", minWidth: "11ch", margin: 0, paddingLeft: 2 }}
                size={Math.max(11, store.handle.length + 1)}
                value={store.handle}
                placeholder="instagram (optional)"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={30}
                onChange={(e) => set({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, "") })}
              />
            </label>
          )}
          {!editable && store.handle && (
            <a
              href={`https://instagram.com/${store.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="sf-muted mt-2 inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
              </svg>
              @{store.handle}
            </a>
          )}
          <div className="mt-4 text-left text-[15px] leading-relaxed">
            {editable ? (
              <AutoText
                label="Bio"
                className="text-center"
                value={store.bio}
                maxLength={600}
                placeholder="Who you help and how"
                invalid={showErrors && !store.bio.trim()}
                onChange={(v) => set({ bio: v })}
              />
            ) : (
              <p className="whitespace-pre-line text-center">{store.bio}</p>
            )}
          </div>
          {bioTools && <div className="mt-3 flex flex-wrap justify-center gap-2">{bioTools}</div>}
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pb-10">
        {store.products.map((p, i) => {
          const busy = productBusy?.(i);
          const bad = (v: string) => showErrors && !v.trim();
          return (
            <article key={p.id} className="sf-card relative p-5" id={`p-${p.id}`}>
              {busy && (
                <div className="busy-veil">
                  <span className="spin" /> {busy}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                {editable ? (
                  <select
                    aria-label="Product format"
                    className="sf-pill appearance-none pr-6"
                    style={{
                      backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E\")",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 8px center",
                    }}
                    value={p.format}
                    onChange={(e) => {
                      const f = e.target.value as Format;
                      // the button text, "per month" note and price reason all belong to the old format
                      setP(i, { format: f, cta: FORMAT_CTA[f], priceNote: PRICE_BANDS[f].note, priceRationale: "" });
                    }}
                  >
                    {FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {FORMAT_LABEL[f]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="sf-pill">{FORMAT_LABEL[p.format]}</span>
                )}
                <div className="text-right">
                  {editable ? (
                    <label className="inline-flex items-baseline text-xl font-extrabold">
                      ₹
                      <input
                        aria-label="Price in rupees"
                        inputMode="numeric"
                        className="ed text-left tabular-nums"
                        style={{ width: `calc(${Math.max(1, String(p.price || "").length)}ch + 9px)`, margin: "0 -6px 0 0", paddingLeft: 2, paddingRight: 2 }}
                        value={p.price ? String(p.price) : ""}
                        placeholder="0"
                        onChange={(e) => {
                          const n = Math.min(MAX_PRICE, Number(e.target.value.replace(/[^\d]/g, "").slice(0, 6)));
                          setP(i, { price: n, priceRationale: "" }); // AI's reason no longer applies
                        }}
                      />
                    </label>
                  ) : (
                    <div className="text-xl font-extrabold">{p.price === 0 ? "Free" : inr(p.price)}</div>
                  )}
                  {p.priceNote && <div className="sf-muted text-xs">{p.priceNote}</div>}
                </div>
              </div>

              <div className="mt-3">
                {editable ? (
                  <AutoText
                    label="Product title"
                    single
                    className="text-lg font-bold leading-snug"
                    value={p.title}
                    maxLength={90}
                    placeholder="Product title"
                    invalid={bad(p.title)}
                    onChange={(v) => setP(i, { title: v })}
                  />
                ) : (
                  <h2 className="text-lg font-bold leading-snug">{p.title}</h2>
                )}
              </div>
              <div className="sf-muted mt-2 text-[15px] leading-relaxed">
                {editable ? (
                  <AutoText
                    label="Product description"
                    value={p.description}
                    maxLength={700}
                    placeholder="What the buyer gets and who it's for"
                    invalid={bad(p.description)}
                    onChange={(v) => setP(i, { description: v })}
                  />
                ) : (
                  <p className="whitespace-pre-line">{p.description}</p>
                )}
              </div>

              {(p.includes.length > 0 || editable) && (
                <ul className="mt-3 space-y-1.5 text-[14px]">
                  {p.includes.map((line, k) =>
                    editable ? (
                      <li key={k} className="flex items-start gap-2">
                        <span aria-hidden className="mt-[3px] text-[color:var(--accent)]">✓</span>
                        <AutoText
                          label={`What's included, point ${k + 1}`}
                          single
                          value={line}
                          maxLength={120}
                          placeholder="Something the buyer gets (leave empty to remove)"
                          onChange={(v) => setP(i, { includes: p.includes.map((x, m) => (m === k ? v : x)) })}
                        />
                      </li>
                    ) : line.trim() ? (
                      <li key={k} className="flex items-start gap-2">
                        <span aria-hidden className="text-[color:var(--accent)]">✓</span>
                        <span>{line}</span>
                      </li>
                    ) : null,
                  )}
                  {editable && p.includes.length < 4 && (
                    <li>
                      <button
                        type="button"
                        className="sf-muted text-[13px] font-semibold underline underline-offset-2"
                        onClick={() => setP(i, { includes: [...p.includes, ""] })}
                      >
                        + Add a point
                      </button>
                    </li>
                  )}
                </ul>
              )}

              {editable && p.priceRationale && (
                <details className="mt-3 rounded-xl px-3 py-2 text-[13px]" style={{ background: "var(--accent-soft)" }}>
                  <summary className="cursor-pointer font-semibold">Why {inr(p.price)}?</summary>
                  <p className="mt-1 leading-relaxed">{p.priceRationale}</p>
                </details>
              )}

              <button
                type="button"
                className="sf-cta mt-4"
                onClick={() => onCta?.(p)}
                tabIndex={editable ? -1 : 0}
                aria-hidden={editable || undefined}
              >
                {p.cta || "Get it"} · {p.price === 0 ? "Free" : inr(p.price)}
              </button>

              {productTools && <div className="mt-3 flex flex-wrap gap-2">{productTools(i)}</div>}
            </article>
          );
        })}
        {afterProducts}
      </main>
      {footer}
    </div>
  );
}
