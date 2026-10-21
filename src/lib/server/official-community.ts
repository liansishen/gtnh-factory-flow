import { NextResponse } from "next/server";

/**
 * Read-only access to the official community's public plans.
 *
 * The official API is the same Next.js application this fork grew from, so its
 * list, detail, download, preview and card responses already have the shapes
 * this site renders. Only reads are proxied: posting, voting and commenting
 * stay on this site's own hub (or are refused) because the official service
 * would not know this account, device or session.
 *
 * `OFFICIAL_COMMUNITY_URL` turns the source on. Without it every route keeps
 * using this site's database.
 */

const TIMEOUT_MS = 20_000;
const PLAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Query parameters the official list understands; everything else stays here. */
const LIST_PARAMS = [
  "sort",
  "search",
  "maxTierIndex",
  "gameVersion",
  "maxEuT",
  "makes",
  "takes",
  "page",
  "pageSize",
] as const;

export function officialCommunityBaseUrl(): string | undefined {
  const base = process.env.OFFICIAL_COMMUNITY_URL?.trim().replace(/\/+$/, "");
  return base || undefined;
}

export function isOfficialCommunity(): boolean {
  return officialCommunityBaseUrl() !== undefined;
}

/** Plan ids are UUIDs; anything else never reaches the upstream URL. */
export function officialPlanId(value: string): string | undefined {
  return PLAN_ID.test(value) ? value : undefined;
}

/** The list query as the official API reads it, with local-only keys dropped. */
export function officialListQuery(url: URL): string {
  const params = new URLSearchParams();
  for (const key of LIST_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      params.set(key, value);
    }
  }
  return params.toString();
}

export async function fetchOfficialCommunity(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = officialCommunityBaseUrl();
  if (!base) {
    throw new Error("The official community is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timeout.unref?.();
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "GTNH-Factory-Flow official-community-reader",
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** The upstream's body and status, so its errors reach the browser unchanged. */
export async function proxyOfficialJson(upstream: Response): Promise<NextResponse> {
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Reads are welcome; every write belongs to the official site's own account. */
export function officialReadOnlyResponse(): NextResponse {
  return NextResponse.json(
    { error: "The official community is read-only here. Open the plan as a copy to edit it." },
    { status: 403 },
  );
}
