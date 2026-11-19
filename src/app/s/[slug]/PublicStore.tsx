"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StoreView from "@/components/StoreView";
import { inr } from "@/lib/pricing";
import type { Product, Storefront } from "@/lib/types";

function beacon(body: object) {
  const data = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.("/api/track", data)) return;
  } catch {
    /* fall through */
  }
  fetch("/api/track", { method: "POST", body: data, keepalive: true }).catch(() => {});
}

export default function PublicStore({ slug, store }: { slug: string; store: Storefront }) {
  const [picked, setPicked] = useState<Product | null>(null);

  useEffect(() => {
    // one view per browser session, so refreshes don't inflate the count
    const k = `viewed:${slug}`;
    try {
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch {
      /* ignore */
    }
    beacon({ slug, event: "view" });
  }, [slug]);

  const bg = store.theme === "midnight" ? "#0f1222" : store.theme === "minimal" ? "#ffffff" : "#fff8f1";

  return (
    <div style={{ background: bg }} className="min-h-dvh">
      <div className="mx-auto max-w-[560px]">
        <StoreView
          store={store}
          onCta={(p) => {
            beacon({ slug, event: "click", productId: p.id });
            setPicked(p);
          }}
          footer={
            <footer className="sf-muted px-5 pb-10 text-center text-[13px]">
              <Link href="/" className="font-semibold underline underline-offset-2">
                Make your own store in a minute →
              </Link>
            </footer>
          }
        />
      </div>

      {picked && (
        <div className="sheet-backdrop" onClick={() => setPicked(null)}>
          <div className="sheet text-center" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="text-3xl">🛒</div>
            <h2 className="mt-2 text-lg font-bold">{picked.title}</h2>
            <p className="mt-1 text-2xl font-extrabold">{picked.price === 0 ? "Free" : inr(picked.price)}</p>
            <p className="hint mx-auto mt-3 max-w-xs">
              Checkout isn&apos;t switched on for this demo store yet. On SuperProfile this button opens UPI and card payment.
            </p>
            <button className="btn btn-primary mt-5 w-full" onClick={() => setPicked(null)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
