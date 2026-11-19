import { Redis } from "@upstash/redis";
import { createHash, randomBytes } from "crypto";
import { customAlphabet } from "nanoid";
import type { Source, Storefront } from "./types";

export type SavedStore = {
  slug: string;
  storefront: Storefront;
  source: Source;
  editKeyHash: string;
  createdAt: number;
  updatedAt: number;
};

/* Upstash Redis in production (env names from the Vercel integration or Upstash directly);
   an in-memory map for local development without credentials. */
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

type Mem = { kv: Map<string, unknown>; counters: Map<string, number> };
const g = globalThis as unknown as { __mem?: Mem };
const mem: Mem = (g.__mem ??= { kv: new Map(), counters: new Map() });

export const hasDb = () => !!redis;

async function get<T>(key: string): Promise<T | null> {
  if (redis) return (await redis.get<T>(key)) ?? null;
  return (mem.kv.get(key) as T) ?? null;
}
async function set(key: string, val: unknown) {
  if (redis) await redis.set(key, val);
  else mem.kv.set(key, val);
}
async function incr(key: string, ttlSec?: number): Promise<number> {
  if (redis) {
    const n = await redis.incr(key);
    if (ttlSec && n === 1) await redis.expire(key, ttlSec);
    return n;
  }
  const n = (mem.counters.get(key) ?? 0) + 1;
  mem.counters.set(key, n);
  return n;
}
async function hincr(key: string, field: string) {
  if (redis) await redis.hincrby(key, field, 1);
  else mem.counters.set(`${key}:${field}`, (mem.counters.get(`${key}:${field}`) ?? 0) + 1);
}
async function hgetall(key: string): Promise<Record<string, number>> {
  if (redis) {
    const r = (await redis.hgetall<Record<string, number>>(key)) ?? {};
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
  }
  const out: Record<string, number> = {};
  for (const [k, v] of mem.counters) if (k.startsWith(key + ":")) out[k.slice(key.length + 1)] = v;
  return out;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const suffix = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 5);

export function slugify(name: string, handle: string) {
  const base = (handle || name)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `${base || "store"}-${suffix()}`;
}

export async function createStore(storefront: Storefront, source: Source) {
  let slug = slugify(storefront.name, storefront.handle);
  for (let i = 0; i < 3 && (await get(`store:${slug}`)); i++) slug = slugify(storefront.name, storefront.handle);
  const editKey = randomBytes(12).toString("base64url");
  const now = Date.now();
  await set(`store:${slug}`, { slug, storefront, source, editKeyHash: hash(editKey), createdAt: now, updatedAt: now });
  return { slug, editKey };
}

export async function getStore(slug: string) {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  return get<SavedStore>(`store:${slug}`);
}

export async function updateStore(slug: string, editKey: string, storefront: Storefront, source?: Source) {
  const cur = await getStore(slug);
  if (!cur) return "not_found" as const;
  if (cur.editKeyHash !== hash(editKey)) return "forbidden" as const;
  await set(`store:${slug}`, { ...cur, storefront, source: source ?? cur.source, updatedAt: Date.now() });
  return "ok" as const;
}

export async function canEdit(slug: string, editKey: string) {
  const cur = await getStore(slug);
  return !!cur && cur.editKeyHash === hash(editKey);
}

export async function track(slug: string, field: string) {
  await hincr(`stats:${slug}`, field);
}
export const getStats = (slug: string) => hgetall(`stats:${slug}`);

/** Fixed-window rate limit; protects the free LLM quota from one person hammering it. */
export async function rateLimit(ip: string, bucket: string, limit: number, windowSec: number) {
  const win = Math.floor(Date.now() / 1000 / windowSec);
  const n = await incr(`rl:${bucket}:${ip}:${win}`, windowSec);
  return n <= limit;
}
