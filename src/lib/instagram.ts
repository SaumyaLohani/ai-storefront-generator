import type { InstagramSignals } from "./types";

const HANDLE_RE = /^[a-zA-Z0-9._]{1,30}$/;

export function cleanHandle(raw: string): string {
  let h = (raw || "").trim();
  // accept full profile URLs too: instagram.com/name/
  const m = h.match(/instagram\.com\/([^/?#\s]+)/i);
  if (m) h = m[1];
  return h.replace(/^@+/, "").replace(/\/+$/, "").toLowerCase();
}

// Links to posts, reels and app pages, which are not profiles
const NOT_PROFILES = new Set(["p", "reel", "reels", "stories", "explore", "tv", "accounts", "direct"]);

export function isValidHandle(h: string) {
  return HANDLE_RE.test(h) && !NOT_PROFILES.has(h) && !h.startsWith(".") && !h.endsWith(".") && !h.includes("..");
}

/**
 * Best-effort read of a public Instagram profile through the same JSON endpoint the
 * instagram.com web app uses. It is often blocked from cloud IPs, so every failure
 * maps to a status the UI can explain, and generation never depends on it.
 */
export async function fetchInstagram(raw: string, timeoutMs = 4500): Promise<InstagramSignals> {
  const handle = cleanHandle(raw);
  if (!handle) return { status: "skipped", handle: "" };
  if (!isValidHandle(handle)) return { status: "invalid", handle };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      {
        signal: ctrl.signal,
        headers: {
          "x-ig-app-id": "936619743392459",
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (res.status === 404) return { status: "not_found", handle };
    if (!res.ok) return { status: "unavailable", handle };
    const json = await res.json().catch(() => null);
    const u = json?.data?.user;
    if (!u) return { status: json?.data ? "not_found" : "unavailable", handle };

    const captions: string[] = (u.edge_owner_to_timeline_media?.edges ?? [])
      .map((e: { node?: { edge_media_to_caption?: { edges?: { node?: { text?: string } }[] } } }) =>
        e?.node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? "",
      )
      .filter(Boolean)
      .slice(0, 8)
      .map((c: string) => c.slice(0, 300));

    return {
      status: u.is_private ? "private" : "found",
      handle,
      fullName: u.full_name || undefined,
      biography: u.biography || undefined,
      followers: u.edge_followed_by?.count,
      category: u.category_name || u.business_category_name || undefined,
      captions: u.is_private ? [] : captions,
    };
  } catch {
    return { status: "unavailable", handle };
  } finally {
    clearTimeout(t);
  }
}
