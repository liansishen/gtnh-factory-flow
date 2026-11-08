import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const gunzipAsync = promisify(gunzip);

export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array> | null;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array> | string,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
    },
  ): Promise<unknown>;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch?(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
  exec?(query: string): Promise<unknown>;
}

export interface AssetsFetcherLike {
  fetch(input: Request | string | URL): Promise<Response>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface CloudflareRuntimeBindings {
  DATASET_BUCKET?: R2BucketLike;
  DB?: D1DatabaseLike;
  ASSETS?: AssetsFetcherLike;
  ctx?: ExecutionContextLike;
  OFFICIAL_TEXTURE_ORIGIN?: string;
}

let explicitBindings: CloudflareRuntimeBindings | undefined;

export function setCloudflareRuntimeBindings(bindings: CloudflareRuntimeBindings | undefined): void {
  explicitBindings = bindings;
}

export function getCloudflareRuntimeBindings(): CloudflareRuntimeBindings {
  if (explicitBindings) {
    return explicitBindings;
  }
  const globalAny = globalThis as Record<PropertyKey, unknown>;
  const globalEnv = globalAny.__cloudflareEnv as CloudflareRuntimeBindings | undefined;
  const globalCtx = globalAny.__cloudflareCtx as ExecutionContextLike | undefined;
  if (globalEnv) {
    return globalCtx && !globalEnv.ctx ? { ...globalEnv, ctx: globalCtx } : globalEnv;
  }
  const openNextCtx = globalAny[Symbol.for("__cloudflare-context__")] as
    | { env?: CloudflareRuntimeBindings; ctx?: ExecutionContextLike }
    | undefined;
  if (openNextCtx?.env) {
    return openNextCtx.ctx && !openNextCtx.env.ctx
      ? { ...openNextCtx.env, ctx: openNextCtx.ctx }
      : openNextCtx.env;
  }
  return {};
}

export function getDatasetRoot(): string {
  return process.env.GTNH_DATASET_ROOT
    ? path.resolve(process.env.GTNH_DATASET_ROOT)
    : path.join(process.cwd(), "public", "datasets", "gtnh");
}

function normalizeDatasetRelativePath(relativePath: string): string {
  return relativePath
    .replace(/^\/+/, "")
    .replace(/^datasets\/gtnh\/+/, "")
    .replace(/\\/g, "/");
}

/**
 * Reads a raw file under `/datasets/gtnh/<relativePath>` from R2, D1 blob table,
 * Cloudflare Workers Static Assets, or the local filesystem.
 */
export async function readDatasetBytes(relativePath: string): Promise<Uint8Array | undefined> {
  const normalized = normalizeDatasetRelativePath(relativePath);
  const bindings = getCloudflareRuntimeBindings();
  const rawCandidate = normalized.endsWith(".gz") ? normalized.slice(0, -3) : undefined;

  if (bindings.DATASET_BUCKET) {
    if (rawCandidate) {
      const rawObject = await bindings.DATASET_BUCKET.get(`datasets/gtnh/${rawCandidate}`);
      if (rawObject) {
        return new Uint8Array(await rawObject.arrayBuffer());
      }
    }
    const object = await bindings.DATASET_BUCKET.get(`datasets/gtnh/${normalized}`);
    if (object) {
      return new Uint8Array(await object.arrayBuffer());
    }
  }

  if (bindings.ASSETS) {
    const assetUrl = `https://assets.local/datasets/gtnh/${normalized}`;
    const response = await bindings.ASSETS.fetch(
      new Request(assetUrl, {
        headers: {
          "Accept-Encoding": "identity",
        },
      }),
    );
    if (response.ok) {
      return new Uint8Array(await response.arrayBuffer());
    }
  }

  try {
    const filePath = path.join(getDatasetRoot(), ...normalized.split("/"));
    const data = await fs.readFile(filePath);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } catch {
    return undefined;
  }
}

export async function datasetFileExists(relativePath: string): Promise<boolean> {
  const normalized = normalizeDatasetRelativePath(relativePath);
  const bindings = getCloudflareRuntimeBindings();
  const rawCandidate = normalized.endsWith(".gz") ? normalized.slice(0, -3) : undefined;

  if (bindings.DATASET_BUCKET) {
    if (rawCandidate) {
      const rawObject = await bindings.DATASET_BUCKET.get(`datasets/gtnh/${rawCandidate}`);
      if (rawObject) {
        return true;
      }
    }
    const object = await bindings.DATASET_BUCKET.get(`datasets/gtnh/${normalized}`);
    if (object) {
      return true;
    }
  }

  if (bindings.ASSETS) {
    const assetUrl = `https://assets.local/datasets/gtnh/${normalized}`;
    const response = await bindings.ASSETS.fetch(new Request(assetUrl, { method: "HEAD" }));
    if (response.ok) {
      return true;
    }
    const getResponse = await bindings.ASSETS.fetch(new Request(assetUrl));
    if (getResponse.ok) {
      await getResponse.body?.cancel().catch(() => undefined);
      return true;
    }
  }

  try {
    const filePath = path.join(getDatasetRoot(), ...normalized.split("/"));
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function isGzipBuffer(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gunzipBytesIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzipBuffer(bytes)) {
    return bytes;
  }
  const unzipped = await gunzipAsync(bytes);
  return new Uint8Array(unzipped.buffer, unzipped.byteOffset, unzipped.byteLength);
}

export async function readDatasetGzipBytes(relativePath: string): Promise<Uint8Array> {
  const raw = await readDatasetBytes(relativePath);
  if (!raw) {
    throw new Error(`Dataset artifact not found: ${relativePath}`);
  }
  return gunzipBytesIfNeeded(raw);
}

const textDecoder = new TextDecoder("utf-8");

export async function readDatasetGzipJson<T>(relativePath: string): Promise<T> {
  const bytes = await readDatasetGzipBytes(relativePath);
  return JSON.parse(textDecoder.decode(bytes)) as T;
}

export async function readDatasetJson<T>(relativePath: string): Promise<T> {
  const raw = await readDatasetBytes(relativePath);
  if (!raw) {
    throw new Error(`Dataset JSON not found: ${relativePath}`);
  }
  const bytes = await gunzipBytesIfNeeded(raw);
  return JSON.parse(textDecoder.decode(bytes)) as T;
}

const TEXTURE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

const TEXTURE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const DEFAULT_OFFICIAL_TEXTURE_ORIGIN = "https://gtnhplanner.com";

function getTextureContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return TEXTURE_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function isSafeTextureRelativePath(relativePath: string): boolean {
  const normalized = normalizeDatasetRelativePath(relativePath);
  const segments = normalized.split("/");
  if (segments.length < 3 || segments[1] !== "textures") {
    return false;
  }
  const validSegments = segments.every(
    (segment) => /^[a-zA-Z0-9._-]+$/.test(segment) && segment !== "." && segment !== "..",
  );
  if (!validSegments) {
    return false;
  }
  return /\.(png|webp|jpe?g|gif)$/i.test(segments[segments.length - 1] ?? "");
}

/**
 * Serves a dataset texture from local storage, R2, KV, or Static Assets, falling
 * back to `https://gtnhplanner.com` and caching the fetched image in R2/KV/Edge Cache.
 */
export async function serveDatasetTextureWithFallback(
  relativePath: string,
  options?: {
    fetchImpl?: typeof fetch;
    originUrl?: string;
  },
): Promise<Response> {
  const normalized = normalizeDatasetRelativePath(relativePath);
  if (!isSafeTextureRelativePath(normalized)) {
    return new Response("Invalid texture path.", { status: 400 });
  }

  const contentType = getTextureContentType(normalized);
  const bindings = getCloudflareRuntimeBindings();

  // 1. Check local / R2 / Static Assets first
  const localOrAssetBytes = await readDatasetBytes(normalized);
  if (localOrAssetBytes) {
    return new Response(new Uint8Array(localOrAssetBytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": TEXTURE_CACHE_CONTROL,
        "X-GTNH-Asset-Cache": "HIT-LOCAL",
      },
    });
  }

  // 2. Fetch missing texture from official origin (gtnhplanner.com)
  const originBase = (
    options?.originUrl ??
    bindings.OFFICIAL_TEXTURE_ORIGIN ??
    process.env.OFFICIAL_TEXTURE_ORIGIN ??
    DEFAULT_OFFICIAL_TEXTURE_ORIGIN
  ).replace(/\/+$/, "");
  const upstreamUrl = `${originBase}/datasets/gtnh/${normalized}`;
  const sendFetch = options?.fetchImpl ?? fetch;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await sendFetch(upstreamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 GTNH-Factory-Flow-Dataset/1.0",
      },
    });
  } catch {
    return new Response("Texture origin unavailable.", { status: 502 });
  }

  if (!upstreamResponse.ok) {
    return new Response("Texture not found.", {
      status: upstreamResponse.status === 404 ? 404 : 502,
    });
  }

  const bytes = new Uint8Array(await upstreamResponse.arrayBuffer());
  const resolvedContentType = upstreamResponse.headers.get("content-type") ?? contentType;

  const persistTask = (async () => {
    if (bindings.DATASET_BUCKET) {
      await bindings.DATASET_BUCKET.put(`datasets/gtnh/${normalized}`, bytes, {
        httpMetadata: {
          contentType: resolvedContentType,
          cacheControl: TEXTURE_CACHE_CONTROL,
        },
      }).catch(() => undefined);
    }
  })();

  if (bindings.ctx) {
    bindings.ctx.waitUntil(persistTask);
  } else {
    await persistTask;
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": resolvedContentType,
      "Cache-Control": TEXTURE_CACHE_CONTROL,
      "X-GTNH-Asset-Cache": "MISS",
    },
  });
}
