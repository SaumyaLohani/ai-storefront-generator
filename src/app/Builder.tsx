"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StoreView from "@/components/StoreView";
import {
  AUDIENCE,
  AUDIENCE_LABEL,
  THEMES,
  type Audience,
  type Language,
  type Product,
  type Source,
  type Storefront,
  type Theme,
} from "@/lib/types";

/* ---------------- types & helpers ---------------- */

type IgInfo = { status: string; followers: number | null; fullName: string | null; usedPosts: number; message: string | null } | null;
type Draft = {
  storefront: Storefront;
  source: Source;
  assumptions: string[];
  instagram: IgInfo;
  published?: { slug: string; editKey: string };
  dirty?: boolean; // edited since last publish
};
type Form = { handle: string; about: string; audience: Audience; language: Language };
type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message: string; data?: Record<string, unknown> };

const DRAFT_KEY = "sf-draft-v1";
const OLD_FORM_KEY = "sf-form-v1"; // earlier versions pre-filled the form on reload

async function api<T>(path: string, body?: unknown, signal?: AbortSignal, method = "POST"): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      signal,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: data as T };
    return {
      ok: false,
      status: res.status,
      error: data.error || "error",
      message: data.message || "Something went wrong. Please try again.",
      data,
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, status: 0, error: "aborted", message: "" };
    return { ok: false, status: 0, error: "network", message: "You seem to be offline. Check your internet and try again." };
  }
}

function load<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode etc. */
  }
}

const EXAMPLES: { label: string; text: string }[] = [
  { label: "Fitness", text: "I'm a certified trainer sharing 20-minute home workouts for working women. About 12K followers." },
  { label: "Finance", text: "I explain budgeting, SIPs and credit cards in Hinglish for young salaried people." },
  { label: "Exam prep", text: "I cleared UPSC prelims twice and post daily current affairs notes for aspirants." },
  { label: "Cooking", text: "Home cook from Lucknow sharing quick, healthy tiffin recipes for school kids." },
  { label: "Astrology", text: "Vedic astrologer with 8 years of practice. I post daily rashifal reels in Hindi." },
  { label: "Design", text: "Freelance UI designer teaching Figma basics to college students." },
];

const LANG_OPTS: { v: Language; label: string }[] = [
  { v: "english", label: "English" },
  { v: "hinglish", label: "Hinglish" },
  { v: "hindi", label: "हिंदी" },
];
const THEME_LABEL: Record<Theme, string> = { sunrise: "Sunrise", minimal: "Minimal", midnight: "Midnight" };
const THEME_SWATCH: Record<Theme, string> = {
  sunrise: "linear-gradient(135deg,#ffd9b8,#e8590c)",
  minimal: "linear-gradient(135deg,#fff,#111)",
  midnight: "linear-gradient(135deg,#2c2470,#a78bfa)",
};

const LOADING_STEPS = (hasHandle: boolean) => [
  ...(hasHandle ? ["Reading your Instagram profile"] : ["Understanding what you do"]),
  "Finding things your audience will pay for",
  "Pricing them for Indian buyers",
  "Writing your bio and product pages",
];

type RegenTarget = { kind: "bio" } | { kind: "product"; index: number } | { kind: "product_copy"; index: number } | { kind: "add_product" };
type AiTask = RegenTarget | { kind: "translate"; language: Language };

const REGEN_CHIPS: Record<RegenTarget["kind"], string[]> = {
  bio: ["Shorter", "More personal", "More professional", "Mention who I help"],
  product_copy: ["Shorter", "More exciting", "Simpler words", "Focus on results"],
  product: ["Something cheaper", "Something premium", "A live session", "A digital download"],
  add_product: ["Something cheaper", "Something premium", "A community", "A 1:1 call"],
};
const REGEN_TITLE: Record<RegenTarget["kind"], string> = {
  bio: "Rewrite your bio",
  product_copy: "Rewrite this product's words",
  product: "Swap for a different idea",
  add_product: "Add a product idea",
};

/* ---------------- component ---------------- */

export default function Builder() {
  const [stage, setStage] = useState<"input" | "loading" | "edit">("input");
  const [form, setForm] = useState<Form>({ handle: "", about: "", audience: "unknown", language: "english" });
  const [formMsg, setFormMsg] = useState<{ field: "handle" | "about" | "general" | "link"; text: string; tone: "warn" | "err" } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null); // a draft from a previous visit
  const [history, setHistory] = useState<Storefront[]>([]);
  const [busy, setBusy] = useState<{ bio?: boolean; products: Record<string, string>; adding?: boolean }>({ products: {} });
  const [toast, setToast] = useState<{ text: string; undo?: boolean; tone?: "err" } | null>(null);
  const [regen, setRegen] = useState<RegenTarget | null>(null);
  const [regenText, setRegenText] = useState("");
  const [confirmAll, setConfirmAll] = useState<null | { language?: Language }>(null);
  const [preview, setPreview] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [stats, setStats] = useState<{ views: number; clicks: number } | null>(null);
  const [loadStep, setLoadStep] = useState(0);
  const [slow, setSlow] = useState(false);
  const [opening, setOpening] = useState(false); // loading a store from its edit link
  const [copied, setCopied] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aboutRef = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------- boot: edit link, saved draft, saved form ---------- */
  useEffect(() => {
    const openEditLink = () => {
      const m = location.hash.match(/^#edit=([a-z0-9-]+)\.([A-Za-z0-9_-]+)$/);
      if (!m) return false;
      const [, slug, editKey] = m;
      window.history.replaceState(null, "", location.pathname);
      (async () => {
        setOpening(true);
        setStage("loading");
        const r = await api<{ storefront: Storefront; source: Source }>(
          `/api/store?slug=${slug}&key=${encodeURIComponent(editKey)}`,
          undefined,
          undefined,
          "GET",
        );
        setOpening(false);
        if (r.ok) {
          const d: Draft = { storefront: r.data.storefront, source: r.data.source, assumptions: [], instagram: null, published: { slug, editKey } };
          openSession();
          setHistory([]);
          setSaved(null);
          setPreview(false);
          setDraft(d);
          setStage("edit");
        } else {
          setStage("input");
          setFormMsg({
            field: "link",
            tone: "err",
            text:
              r.status === 403
                ? "That edit link didn't work. It may be incomplete. You can create a new store below."
                : "We couldn't open your store just now. Check your internet and open your edit link again.",
          });
        }
      })();
      return true;
    };
    // pasting the edit link while the app is already open only changes the hash
    const onHash = () => void openEditLink();
    window.addEventListener("hashchange", onHash);
    const off = () => window.removeEventListener("hashchange", onHash);
    const opened = openEditLink();
    if (opened) return off;
    const d = load<Draft>(DRAFT_KEY);
    if (d?.storefront?.products?.length) setSaved(d);
    save(OLD_FORM_KEY, null); // every visit starts with an empty form
    return off;
  }, []);

  // Escape closes whichever sheet is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setRegen(null);
      setConfirmAll(null);
      setShareOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (draft) save(DRAFT_KEY, draft);
  }, [draft]);

  const flash = useCallback((text: string, opts: { undo?: boolean; tone?: "err" } = {}) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, ...opts });
    toastTimer.current = setTimeout(() => setToast(null), opts.undo || opts.tone === "err" ? 6000 : 3500);
  }, []);

  /* ---------- editing with undo ---------- */
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const historyRef = useRef<Storefront[]>([]);
  historyRef.current = history;

  const pushHistory = (sf: Storefront) => setHistory([...historyRef.current.slice(-19), sf]);

  const commit = (next: Storefront, push = true) => {
    const d = draftRef.current;
    if (!d) return;
    if (push) pushHistory(d.storefront);
    setDraft({ ...d, storefront: next, dirty: true });
  };

  // typing: record one history entry per burst of typing, not per keystroke
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEdit = (next: Storefront) => {
    const first = !typingRef.current;
    if (typingRef.current) clearTimeout(typingRef.current);
    typingRef.current = setTimeout(() => (typingRef.current = null), 1200);
    commit(next, first);
  };

  const undo = () => {
    const h = historyRef.current;
    const d = draftRef.current;
    if (!h.length || !d) return;
    if (typingRef.current) clearTimeout(typingRef.current);
    typingRef.current = null; // the next keystroke starts a new undo step
    setDraft({ ...d, storefront: h[h.length - 1], dirty: true });
    setHistory(h.slice(0, -1));
    setToast(null);
  };

  /* ---------- generation ---------- */
  const startGenerate = async (opts: { fromDraft?: Draft } = {}) => {
    const base = opts.fromDraft;
    const body = base
      ? {
          handle: base.storefront.handle, // they may have corrected it on the page
          about: base.source.about,
          audience: base.source.audience,
          language: base.storefront.language,
          keepName: base.storefront.name.trim() || undefined,
          avoid: base.storefront.products.map((p) => p.title),
        }
      : { ...form };

    if (!base) {
      setFormMsg(null);
      if (!form.handle.trim() && !form.about.trim()) {
        setFormMsg({ field: "about", tone: "err", text: "Add your Instagram username, or tell us in a line what you do." });
        aboutRef.current?.focus();
        return;
      }
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    cancelledRef.current = false;
    const killer = setTimeout(() => ctrl.abort(), 60000);

    const prevStage = stage;
    setStage("loading");
    window.scrollTo({ top: 0 });
    setLoadStep(0);
    setSlow(false);
    const steps = LOADING_STEPS(!!body.handle?.trim()).length;
    const iv = setInterval(() => setLoadStep((s) => Math.min(s + 1, steps - 1)), 1800);
    const slowT = setTimeout(() => setSlow(true), 15000);

    const r = await api<{ storefront: Storefront; source: Source; assumptions: string[]; instagram: IgInfo }>(
      "/api/generate",
      body,
      ctrl.signal,
    );
    clearInterval(iv);
    clearTimeout(slowT);
    clearTimeout(killer);

    if (r.ok) {
      const d: Draft = {
        storefront: { ...r.data.storefront, theme: base?.storefront.theme ?? r.data.storefront.theme },
        source: r.data.source,
        assumptions: r.data.assumptions,
        instagram: r.data.instagram,
        published: base?.published,
        dirty: true,
      };
      if (base) pushHistory(base.storefront);
      else {
        setHistory([]);
        openSession();
      }
      setDraft(d);
      setSaved(null);
      setStage("edit");
      setPreview(false);
      setShowErrors(false);
      window.scrollTo({ top: 0 });
      if (base) flash("Fresh ideas ready", { undo: true });
      return;
    }

    // failure paths: never a dead end
    if (base) {
      setStage(prevStage === "loading" ? "edit" : prevStage);
      if (r.error === "aborted" && cancelledRef.current) return;
      const busy = r.error === "ai_down" || r.error === "busy" || r.error === "aborted";
      const noProfile = r.error === "need_about" && "We couldn't read your Instagram again just now. Your store is unchanged.";
      flash(busy ? "AI is busy right now. Your store is unchanged, so try again in a moment." : noProfile || r.message || "Couldn't regenerate. Your store is unchanged.", { tone: "err" });
      return;
    }
    setStage("input");
    if (r.error === "aborted") {
      if (!cancelledRef.current)
        setFormMsg({ field: "general", tone: "err", text: "That took too long. Your details are saved, so tap Try again." });
      return;
    }
    if (r.error === "need_about" && r.data?.igStatus === "invalid") {
      setFormMsg({ field: "handle", tone: "err", text: r.message });
    } else if (r.error === "need_about") {
      setFormMsg({ field: "about", tone: "warn", text: r.message });
      setTimeout(() => aboutRef.current?.focus(), 50);
    } else if (r.error === "unclear" || r.error === "blocked") {
      setFormMsg({ field: "about", tone: "warn", text: r.message });
      setTimeout(() => aboutRef.current?.focus(), 50);
    } else if (r.error === "empty") {
      setFormMsg({ field: "about", tone: "err", text: r.message });
    } else {
      setFormMsg({ field: "general", tone: "err", text: r.message });
    }
  };
  const cancelledRef = useRef(false);
  const cancel = () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
  };

  /* ---------- part regeneration ---------- */
  // bumped whenever another store opens, so a late AI answer can't land in the wrong one
  const session = useRef(0);
  const openSession = () => {
    session.current++;
    setBusy({ products: {} });
    setStats(null);
    setShareOpen(false);
    setRegen(null);
    setToast(null);
    typingRef.current = null;
  };
  const openRegen = (t: RegenTarget) => {
    setRegenText("");
    setRegen(t);
  };
  const runRegen = async (target: AiTask, instruction: string) => {
    if (!draft) return;
    setRegen(null);
    setRegenText("");
    const snapshot = draft.storefront;
    const run = session.current;
    const busyId = "index" in target ? snapshot.products[target.index]?.id : undefined;
    if ("index" in target && !busyId) return;
    const label =
      target.kind === "bio" ? "" : target.kind === "product_copy" ? "Rewriting…" : target.kind === "product" ? "Finding a new idea…" : "";
    setBusy((b) => ({
      ...b,
      bio: target.kind === "bio" || target.kind === "translate" ? true : b.bio,
      adding: target.kind === "add_product" ? true : b.adding,
      products: target.kind === "translate" ? Object.fromEntries(snapshot.products.map((p) => [p.id, "Translating…"])) : busyId ? { ...b.products, [busyId]: label } : b.products,
    }));
    const clean = cleanForSend(snapshot);
    const r = await api<{ patch: Partial<Storefront> & { product?: Product } }>("/api/regenerate", {
      storefront: clean,
      source: draft.source,
      part: target,
      instruction,
    });
    if (run !== session.current) return; // a different store is open now
    setBusy((b) => {
      const products = { ...b.products };
      if (busyId) delete products[busyId];
      if (target.kind === "translate") snapshot.products.forEach((p) => delete products[p.id]);
      return {
        ...b,
        bio: target.kind === "bio" || target.kind === "translate" ? false : b.bio,
        adding: target.kind === "add_product" ? false : b.adding,
        products,
      };
    });
    if (!r.ok) {
      if (r.error === "aborted") return;
      const busy = r.error === "ai_down" || r.error === "busy";
      flash(busy ? "AI is busy right now. Nothing was changed, so try again in a moment." : r.message || "Couldn't do that right now. Nothing was changed.", { tone: "err" });
      if (r.status === 400) setShowErrors(true);
      return;
    }
    const d = draftRef.current;
    if (!d) return;
    const cur = d.storefront;
    const patch = r.data.patch;
    let next: Storefront = cur;
    if (target.kind === "bio") next = { ...cur, tagline: patch.tagline ?? cur.tagline, bio: patch.bio ?? cur.bio };
    else if (target.kind === "translate" && patch.products) {
      const byId = new Map(patch.products.map((p) => [p.id, p]));
      next = { ...cur, language: target.language, tagline: patch.tagline ?? cur.tagline, bio: patch.bio ?? cur.bio, products: cur.products.map((p) => byId.get(p.id) ?? p) };
    } else if (target.kind === "add_product" && cur.products.length >= 4) {
      flash("Your store already has 4 products, so we didn't add another.");
      return;
    } else if (target.kind === "add_product" && patch.product) next = { ...cur, products: [...cur.products, patch.product].slice(0, 4) };
    else if ("index" in target && patch.product) {
      // find by id in case products were reordered/removed while we waited
      const id = busyId!;
      if (!cur.products.some((p) => p.id === id)) {
        flash("That product was removed, so we skipped the rewrite.");
        return;
      }
      next = { ...cur, products: cur.products.map((p) => (p.id === id ? { ...patch.product!, id } : p)) };
    }
    pushHistory(cur);
    setDraft({ ...d, storefront: next, dirty: true });
    flash(
      target.kind === "translate" ? "Rewritten in the new language" : target.kind === "bio" ? "New bio written" : target.kind === "add_product" ? "Product added" : target.kind === "product" ? "New idea swapped in" : "Rewritten",
      { undo: true },
    );
    if (target.kind === "add_product") setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }), 80);
  };

  const removeProduct = (i: number) => {
    if (!draft) return;
    if (draft.storefront.products.length <= 1) {
      flash("Your store needs at least one product.", { tone: "err" });
      return;
    }
    commit({ ...draft.storefront, products: draft.storefront.products.filter((_, j) => j !== i) });
    flash("Product removed", { undo: true });
  };

  /* ---------- publish ---------- */
  function cleanForSend(s: Storefront): Storefront {
    return {
      ...s,
      name: s.name.trim(),
      bio: s.bio.trim(),
      tagline: s.tagline.trim(),
      products: s.products.map((p) => ({
        ...p,
        title: p.title.trim(),
        description: p.description.trim(),
        includes: p.includes.map((x) => x.trim()).filter(Boolean),
      })),
    };
  }

  const firstProblem = (s: Storefront): string | null => {
    if (!s.name.trim()) return "Add your name";
    if (!s.bio.trim()) return "Add a bio";
    for (const p of s.products) {
      if (!p.title.trim()) return "Every product needs a title";
      if (!p.description.trim()) return "Every product needs a description";
    }
    return null;
  };

  const publish = async () => {
    if (!draft) return;
    const problem = firstProblem(draft.storefront);
    if (problem) {
      setShowErrors(true);
      setPreview(false);
      flash(`${problem}. We've highlighted it in red.`, { tone: "err" });
      setTimeout(() => document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
      return;
    }
    setPublishing(true);
    const sent = draft.storefront;
    const clean = cleanForSend(sent);
    const r = await api<{ slug: string; editKey: string; updated: boolean }>("/api/publish", {
      storefront: clean,
      source: draft.source,
      slug: draft.published?.slug,
      editKey: draft.published?.editKey,
    });
    setPublishing(false);
    if (!r.ok) {
      flash(r.message, { tone: "err" });
      return;
    }
    setDraft((d) => {
      if (!d) return d;
      const unchanged = d.storefront === sent; // otherwise they kept typing while we saved: keep those edits
      return { ...d, storefront: unchanged ? clean : d.storefront, published: { slug: r.data.slug, editKey: r.data.editKey }, dirty: !unchanged };
    });
    setShareOpen(true);
    if (r.data.updated) flash("Your live page is updated");
  };

  useEffect(() => {
    if (!shareOpen || !draft?.published) return;
    const { slug, editKey } = draft.published;
    api<{ stats: { views: number; clicks: number } }>(`/api/store?slug=${slug}&key=${encodeURIComponent(editKey)}`, undefined, undefined, "GET").then(
      (r) => r.ok && setStats(r.data.stats),
    );
  }, [shareOpen, draft?.published]);

  const origin = typeof window !== "undefined" ? location.origin : "";
  const liveUrl = draft?.published ? `${origin}/s/${draft.published.slug}` : "";
  const editUrl = draft?.published ? `${origin}/#edit=${draft.published.slug}.${draft.published.editKey}` : "";

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 1800);
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: draft?.storefront.name, text: `Check out my store: ${draft?.storefront.tagline}`, url: liveUrl });
      } catch {
        /* dismissed */
      }
    } else copy(liveUrl, "link");
  };

  const startOver = () => {
    if (draft && !confirm(draft.published ? "Start a new store? Your published page stays live. To edit it later, first copy your private edit link (tap Share link)." : "Start over? This draft will be cleared.")) return;
    save(DRAFT_KEY, null);
    setDraft(null);
    setSaved(null);
    setHistory([]);
    openSession();
    setPreview(false);
    setShowErrors(false);
    setForm({ handle: "", about: "", audience: "unknown", language: "english" });
    setStage("input");
    setFormMsg(null);
    window.scrollTo({ top: 0 });
  };

  /* ================= RENDER ================= */

  if (stage === "loading" && opening)
    return (
      <div className="shell flex min-h-dvh items-center justify-center gap-3 font-semibold" aria-live="polite">
        <span className="spin text-[var(--app-brand)]" /> Opening your store…
      </div>
    );

  if (stage === "loading") {
    const steps = LOADING_STEPS(!!(draft?.source.handle || form.handle).trim());
    return (
      <div className="shell pt-10" aria-live="polite">
        <div className="mx-auto max-w-sm">
          <h1 className="text-2xl font-extrabold">Building your store…</h1>
          <p className="hint mt-1">This usually takes 5–15 seconds.</p>
          <ol className="mt-6 space-y-3">
            {steps.map((s, i) => (
              <li key={s} className={`flex items-center gap-3 text-[15px] ${i > loadStep ? "opacity-40" : ""}`}>
                {i < loadStep ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--app-ok)] text-xs text-white">✓</span>
                ) : i === loadStep ? (
                  <span className="spin text-[var(--app-brand)]" />
                ) : (
                  <span className="h-5 w-5 rounded-full border-2 border-[var(--app-line)]" />
                )}
                {s}
              </li>
            ))}
          </ol>
          {slow && <p className="notice notice-info mt-6">Taking a little longer than usual. Hang on, we&apos;re still working on it.</p>}
          <div className="mt-8 space-y-3" aria-hidden>
            <div className="shimmer mx-auto h-16 w-16 rounded-full" />
            <div className="shimmer mx-auto h-5 w-40" />
            <div className="shimmer h-24" />
            <div className="shimmer h-40" />
          </div>
          <button className="btn btn-ghost mt-6 w-full" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (stage === "edit" && draft) {
    const s = draft.storefront;
    const anyBusy = !!busy.bio || !!busy.adding || Object.keys(busy.products).length > 0;
    return (
      <div className="min-h-dvh pb-28">
        <div className="topbar">
          <div className="mx-auto flex max-w-[560px] items-center justify-between gap-2 px-4 py-2.5">
            <button className="btn btn-sm btn-ghost" onClick={startOver}>
              ← New
            </button>
            <div className="text-[13px] font-semibold">
              {draft.published ? (
                draft.dirty ? (
                  <span className="text-[var(--app-warn-ink)]">● Unpublished changes</span>
                ) : (
                  <span className="text-[var(--app-ok)]">● Live</span>
                )
              ) : (
                <span className="text-[var(--app-muted)]">Draft</span>
              )}
            </div>
            <div className="flex gap-1.5">
              {history.length > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={undo} aria-label="Undo last change">
                  Undo
                </button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={() => setPreview((p) => !p)}>
                {preview ? "Edit" : "Preview"}
              </button>
            </div>
          </div>
        </div>

        {!preview && (
          <div className="mx-auto max-w-[560px] space-y-2 px-4 pt-3">
            {draft.instagram?.status === "found" && (
              <p className="notice notice-info">
                Built from @{draft.source.handle}
                {draft.instagram.followers != null && ` · ${draft.instagram.followers.toLocaleString("en-IN")} followers`}
                {draft.instagram.usedPosts > 0 && ` · ${draft.instagram.usedPosts} recent posts`}
              </p>
            )}
            {draft.instagram?.message && <p className="notice notice-warn">{draft.instagram.message}</p>}
            {draft.assumptions.length > 0 && (
              <div className="notice notice-warn">
                <strong>We guessed a few things.</strong> Fix anything that&apos;s off:
                <ul className="mt-1 list-disc pl-5">
                  {draft.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="hint text-center">Tap any text to edit it. Use ✨ to let AI rewrite one part.</p>
          </div>
        )}

        <div className="mx-auto mt-3 max-w-[560px] overflow-hidden sm:rounded-3xl sm:border sm:border-[var(--app-line)]">
          <StoreView
            store={s}
            editable={!preview}
            onChange={onEdit}
            showErrors={showErrors}
            bioBusy={busy.bio && (Object.values(busy.products).includes("Translating…") ? "Translating…" : "Writing a new bio…")}
            bioTools={
              preview ? undefined : (
                <button className="tool" disabled={busy.bio} onClick={() => openRegen({ kind: "bio" })}>
                  ✨ Rewrite bio
                </button>
              )
            }
            productBusy={(i) => (s.products[i].id in busy.products ? busy.products[s.products[i].id] || "Working…" : null)}
            productTools={
              preview
                ? undefined
                : (i) => (
                    <>
                      <button className="tool" disabled={s.products[i].id in busy.products} onClick={() => openRegen({ kind: "product_copy", index: i })}>
                        ✨ Rewrite words
                      </button>
                      <button className="tool" disabled={s.products[i].id in busy.products} onClick={() => openRegen({ kind: "product", index: i })}>
                        ↻ Different idea
                      </button>
                      <button className="tool" disabled={s.products[i].id in busy.products} onClick={() => removeProduct(i)} aria-label="Remove product">
                        Remove
                      </button>
                    </>
                  )
            }
            afterProducts={
              !preview && s.products.length < 4 ? (
                <button
                  className="sf-card flex w-full items-center justify-center gap-2 border-dashed p-4 text-[15px] font-semibold"
                  style={{ borderStyle: "dashed" }}
                  disabled={busy.adding}
                  onClick={() => openRegen({ kind: "add_product" })}
                >
                  {busy.adding ? (
                    <>
                      <span className="spin" /> Thinking of another product…
                    </>
                  ) : (
                    <>✨ Add another product idea</>
                  )}
                </button>
              ) : null
            }
            onCta={() => flash("This is the button your buyers tap. Payments are off in this demo.")}
          />
        </div>

        {!preview && (
          <section className="mx-auto mt-6 max-w-[560px] space-y-5 px-4">
            <div>
              <span className="label">Page style</span>
              <div className="flex gap-2">
                {THEMES.map((t) => (
                  <button
                    key={t}
                    className="chip flex items-center gap-2"
                    aria-pressed={s.theme === t}
                    onClick={() => commit({ ...s, theme: t })}
                  >
                    <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: THEME_SWATCH[t] }} />
                    {THEME_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Language</span>
              <div className="flex gap-2">
                {LANG_OPTS.map((l) => (
                  <button
                    key={l.v}
                    className="chip"
                    aria-pressed={s.language === l.v}
                    disabled={anyBusy}
                    onClick={() => l.v !== s.language && setConfirmAll({ language: l.v })}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Not quite right?</span>
              <button className="btn btn-ghost w-full" disabled={anyBusy} onClick={() => setConfirmAll({})}>
                ↻ Regenerate the whole store
              </button>
            </div>
          </section>
        )}

        <div className="bottombar">
          <div className="mx-auto flex max-w-[560px] gap-2">
            {draft.published && !draft.dirty ? (
              <>
                <button className="btn btn-ghost flex-1" onClick={() => setShareOpen(true)}>
                  Share link
                </button>
                <a className="btn btn-primary flex-1" href={liveUrl} target="_blank" rel="noopener">
                  View live page ↗
                </a>
              </>
            ) : (
              <button className="btn btn-primary w-full" disabled={publishing || anyBusy} onClick={publish}>
                {publishing ? (
                  <>
                    <span className="spin" /> Publishing…
                  </>
                ) : draft.published ? (
                  "Update my live page"
                ) : (
                  "Publish my store"
                )}
              </button>
            )}
          </div>
        </div>

        {/* ---- regenerate-part sheet ---- */}
        {regen && (
          <div className="sheet-backdrop" onClick={() => setRegen(null)}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label={REGEN_TITLE[regen.kind]} onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-bold">{REGEN_TITLE[regen.kind]}</h2>
              <p className="hint mt-1">Pick a direction, type your own, or just go.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {REGEN_CHIPS[regen.kind].map((c) => (
                  <button key={c} className="chip" aria-pressed={regenText === c} onClick={() => setRegenText(regenText === c ? "" : c)}>
                    {c}
                  </button>
                ))}
              </div>
              <input
                className="input mt-3"
                placeholder="Or say it in your words (optional)"
                maxLength={200}
                value={regenText}
                onChange={(e) => setRegenText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && runRegen(regen, regenText)}
              />
              <div className="mt-4 flex gap-2">
                <button className="btn btn-ghost flex-1" onClick={() => setRegen(null)}>
                  Cancel
                </button>
                <button className="btn btn-primary flex-1" onClick={() => runRegen(regen, regenText)}>
                  ✨ {regen.kind === "add_product" ? "Suggest" : "Rewrite"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- regenerate-all / language confirm ---- */}
        {confirmAll && (
          <div className="sheet-backdrop" onClick={() => setConfirmAll(null)}>
            <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-bold">
                {confirmAll.language ? `Rewrite your store in ${LANG_OPTS.find((l) => l.v === confirmAll.language)?.label}?` : "Get a fresh set of ideas?"}
              </h2>
              <p className="hint mt-1">
                {confirmAll.language
                  ? "Same products and prices, with the words rewritten in this language. You can undo."
                  : "AI will suggest new products and copy, different from what you have now. Your store name and style stay. You can undo if you liked the old one better."}
              </p>
              <div className="mt-4 flex gap-2">
                <button className="btn btn-ghost flex-1" onClick={() => setConfirmAll(null)}>
                  Keep current
                </button>
                <button
                  className="btn btn-primary flex-1"
                  onClick={() => {
                    const c = confirmAll;
                    setConfirmAll(null);
                    if (c.language) runRegen({ kind: "translate", language: c.language }, "");
                    else startGenerate({ fromDraft: draft });
                  }}
                >
                  {confirmAll.language ? "Rewrite" : "Regenerate"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- share sheet ---- */}
        {shareOpen && draft.published && (
          <div className="sheet-backdrop" onClick={() => setShareOpen(false)}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="Your store is live" onClick={(e) => e.stopPropagation()}>
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#e6f6ec] text-2xl">🎉</div>
                <h2 className="mt-2 text-xl font-extrabold">Your store is live</h2>
                <p className="hint mt-1">Put this link in your Instagram bio and share it with your followers.</p>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--app-line)] p-2 pl-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{liveUrl.replace(/^https?:\/\//, "")}</span>
                <button className="btn btn-sm btn-primary" onClick={() => copy(liveUrl, "link")}>
                  {copied === "link" ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a
                  className="btn btn-ghost"
                  href={`https://wa.me/?text=${encodeURIComponent(`Check out my store 👉 ${liveUrl}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp
                </a>
                <button className="btn btn-ghost" onClick={shareNative}>
                  More options
                </button>
                <a className="btn btn-ghost col-span-2" href={liveUrl} target="_blank" rel="noopener">
                  Open my page ↗
                </a>
              </div>
              {stats && (
                <p className="hint mt-3 text-center">
                  {stats.views} {stats.views === 1 ? "visit" : "visits"} · {stats.clicks} product {stats.clicks === 1 ? "tap" : "taps"} so far
                </p>
              )}
              <div className="mt-4 rounded-xl bg-[var(--app-bg)] p-3 text-[13px]">
                <strong>Your private edit link.</strong> Save it to edit this store from another phone. Don&apos;t share it.
                <button className="mt-2 block font-semibold text-[var(--app-brand)] underline" onClick={() => copy(editUrl, "edit")}>
                  {copied === "edit" ? "Copied ✓" : "Copy edit link"}
                </button>
              </div>
              <button className="btn btn-ghost mt-4 w-full" onClick={() => setShareOpen(false)}>
                Keep editing
              </button>
            </div>
          </div>
        )}

        {toast && (
          <div className="toast" role="status">
            <span>{toast.tone === "err" ? "⚠️ " : ""}{toast.text}</span>
            {toast.undo && history.length > 0 && (
              <button className="font-bold text-[#c4b5fd]" onClick={undo}>
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ---------------- input stage ---------------- */
  const editForm = (patch: Partial<Form>) => {
    setForm({ ...form, ...patch });
    setFormMsg(null); // the old message is about the old text
  };
  const handleInvalid = formMsg?.field === "handle";
  const aboutInvalid = formMsg?.field === "about";
  return (
    <div className="shell">
      <header className="pt-10 pb-6">
        <p className="text-[13px] font-bold tracking-wide text-[var(--app-brand)] uppercase">For creators & coaches</p>
        <h1 className="mt-2 text-[30px] leading-[1.15] font-extrabold">Your store, ready to share in a minute.</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--app-muted)]">
          Tell us who you are. AI suggests what to sell, what to charge in ₹, and writes your page. You edit anything, then share one link.
        </p>
      </header>

      {formMsg?.field === "link" && (
        <p className="notice notice-err mb-5" role="alert">
          {formMsg.text}
        </p>
      )}

      {saved && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-[var(--app-line)] bg-white p-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Continue where you left off</div>
            <div className="hint truncate">{saved.storefront.name} · {saved.storefront.products.length} products</div>
          </div>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              openSession();
              setDraft(saved);
              setSaved(null);
              setHistory([]);
              setStage("edit");
              window.scrollTo({ top: 0 });
            }}
          >
            Open
          </button>
        </div>
      )}

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          startGenerate();
        }}
        noValidate
      >
        <div>
          <label className="label" htmlFor="handle">
            Instagram username <span className="font-normal text-[var(--app-muted)]">(optional)</span>
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[16px] text-[var(--app-muted)]">@</span>
            <input
              id="handle"
              className="input pl-8"
              placeholder="yourname"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              maxLength={200}
              aria-invalid={handleInvalid || undefined}
              aria-describedby={handleInvalid ? "handle-msg" : undefined}
              value={form.handle}
              onChange={(e) => editForm({ handle: e.target.value.replace(/^@+/, "") })}
            />
          </div>
          {handleInvalid && (
            <p id="handle-msg" className="notice notice-err mt-2" role="alert">
              {formMsg?.text}
            </p>
          )}
          <p className="hint mt-1.5">We try to read your public bio and posts. Instagram often blocks this, so add a line below too.</p>
        </div>

        <div>
          <label className="label" htmlFor="about">
            Tell us about yourself
          </label>
          <textarea
            id="about"
            ref={aboutRef}
            className="input min-h-[104px] resize-y"
            autoComplete="off"
            placeholder="What do you post about or teach, and who follows you? English, Hinglish or Hindi is fine."
            maxLength={1000}
            aria-invalid={aboutInvalid && formMsg?.tone === "err" ? true : undefined}
            aria-describedby={aboutInvalid ? "about-msg" : undefined}
            value={form.about}
            onChange={(e) => editForm({ about: e.target.value })}
          />
          {aboutInvalid && (
            <p id="about-msg" className={`notice mt-2 ${formMsg?.tone === "err" ? "notice-err" : "notice-warn"}`} role="alert">
              {formMsg?.text}
            </p>
          )}
          <div className="mt-2.5">
            <span className="hint">Need a starting point? Tap one:</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex.label} type="button" className="chip" onClick={() => editForm({ about: ex.text })}>
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <span className="label">How many followers do you have?</span>
          <div className="flex flex-wrap gap-1.5">
            {AUDIENCE.map((a) => (
              <button key={a} type="button" className="chip" aria-pressed={form.audience === a} onClick={() => setForm({ ...form, audience: a })}>
                {AUDIENCE_LABEL[a]}
              </button>
            ))}
          </div>
          <p className="hint mt-1.5">Helps us price your products. We use your Instagram count if we can read it.</p>
        </div>

        <div>
          <span className="label">Write my page in</span>
          <div className="flex gap-1.5">
            {LANG_OPTS.map((l) => (
              <button key={l.v} type="button" className="chip" aria-pressed={form.language === l.v} onClick={() => setForm({ ...form, language: l.v })}>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bottombar">
          <div className="mx-auto max-w-[560px]">
            {formMsg?.field === "general" && (
              <div className="notice notice-err mb-2.5" role="alert">
                {formMsg.text}
              </div>
            )}
            <button type="submit" className="btn btn-primary w-full text-[16px]">
              {formMsg?.field === "general" ? "Try again" : "Create my store ✨"}
            </button>
          </div>
        </div>
      </form>
      <p className="hint mt-8 text-center">Free · No sign-up · Takes about 10 seconds</p>
    </div>
  );
}
