import type { Metadata } from "next";
import Link from "next/link";
import { getStore } from "@/lib/store";
import PublicStore from "./PublicStore";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

async function safeGet(slug: string) {
  try {
    return await getStore(slug);
  } catch (e) {
    console.error("[s/slug]", e);
    return undefined; // storage down, distinct from "not found"
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const s = await safeGet(slug);
  if (!s) return { title: "Store not found" };
  const sf = s.storefront;
  return {
    title: `${sf.name}${sf.tagline ? " · " + sf.tagline : ""}`,
    description: sf.bio.slice(0, 160),
    openGraph: { title: sf.name, description: sf.tagline || sf.bio.slice(0, 160), type: "website" },
  };
}

export default async function StorePage({ params }: Params) {
  const { slug } = await params;
  const s = await safeGet(slug);
  if (!s) {
    const down = s === undefined;
    return (
      <div className="shell flex min-h-dvh flex-col items-center justify-center text-center">
        <div className="text-4xl">{down ? "⏳" : "🔍"}</div>
        <h1 className="mt-3 text-xl font-extrabold">{down ? "This page is taking a break" : "We couldn't find this store"}</h1>
        <p className="hint mt-2 max-w-xs">
          {down ? "Please refresh in a minute." : "The link may be incomplete or the store was removed. Check the link with whoever shared it."}
        </p>
        <Link href="/" className="btn btn-primary mt-6">
          Create your own store
        </Link>
      </div>
    );
  }
  return <PublicStore slug={slug} store={s.storefront} />;
}
