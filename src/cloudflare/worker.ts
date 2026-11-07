import * as accountsSearchRoute from "@/app/api/accounts/search/route";
import * as blueprintDownloadRoute from "@/app/api/blueprints/[blueprintId]/download/route";
import * as blueprintPublishRoute from "@/app/api/blueprints/[blueprintId]/publish/route";
import * as blueprintDetailRoute from "@/app/api/blueprints/[blueprintId]/route";
import * as blueprintVoteRoute from "@/app/api/blueprints/[blueprintId]/vote/route";
import * as blueprintsRoute from "@/app/api/blueprints/route";
import * as authLoginRoute from "@/app/api/community/auth/login/route";
import * as authLogoutRoute from "@/app/api/community/auth/logout/route";
import * as authMeRoute from "@/app/api/community/auth/me/route";
import * as authRegisterRoute from "@/app/api/community/auth/register/route";
import * as communityImagesRoute from "@/app/api/community/images/route";
import * as communityPlanCommentDetailRoute from "@/app/api/community/plans/[planId]/comments/[commentId]/route";
import * as communityPlanCommentsRoute from "@/app/api/community/plans/[planId]/comments/route";
import * as communityPlanDownloadRoute from "@/app/api/community/plans/[planId]/download/route";
import * as communityPlanPreviewRoute from "@/app/api/community/plans/[planId]/preview/route";
import * as communityPlanDetailRoute from "@/app/api/community/plans/[planId]/route";
import * as communityPlanVoteRoute from "@/app/api/community/plans/[planId]/vote/route";
import * as communityPlansRoute from "@/app/api/community/plans/route";
import * as datasetCatalogRoute from "@/app/api/datasets/[versionId]/catalog/route";
import * as datasetCropsRoute from "@/app/api/datasets/[versionId]/crops/route";
import * as datasetMobsRoute from "@/app/api/datasets/[versionId]/mobs/route";
import * as datasetRecipeIdsRoute from "@/app/api/datasets/[versionId]/recipe-ids/route";
import * as datasetRecipeDetailRoute from "@/app/api/datasets/[versionId]/recipes/[recipeId]/route";
import * as datasetRecipesRoute from "@/app/api/datasets/[versionId]/recipes/route";
import * as datasetResolveRecipesRoute from "@/app/api/datasets/[versionId]/resolve-recipes/route";
import * as datasetResourcesRoute from "@/app/api/datasets/[versionId]/resources/route";
import * as feedbackFileRoute from "@/app/api/feedback/files/[reportId]/[file]/route";
import * as feedbackRoute from "@/app/api/feedback/route";
import * as libraryDesignMemberDetailRoute from "@/app/api/library/designs/[designId]/members/[userId]/route";
import * as libraryDesignMembersRoute from "@/app/api/library/designs/[designId]/members/route";
import * as libraryDesignRoute from "@/app/api/library/designs/[designId]/route";
import * as libraryFolderRoute from "@/app/api/library/folders/[folderId]/route";
import * as libraryRoute from "@/app/api/library/route";
import * as versionRoute from "@/app/api/version/route";
import * as llmsRoute from "@/app/llms.txt/route";
import manifestRoute from "@/app/manifest";
import robotsRoute from "@/app/robots";
import sitemapRoute from "@/app/sitemap";
import {
  readDatasetBytes,
  serveDatasetTextureWithFallback,
  setCloudflareRuntimeBindings,
  type AssetsFetcherLike,
  type D1DatabaseLike,
  type ExecutionContextLike,
  type R2BucketLike,
} from "@/lib/server/dataset-storage";
import {
  fetchOfficialCommunity,
  isOfficialCommunity,
  officialPlanId,
} from "@/lib/server/official-community";
import { describePlanRow, getPublicPlanRow } from "@/lib/server/plan-preview";

export interface WorkerEnv {
  DB?: D1DatabaseLike;
  DATASET_BUCKET?: R2BucketLike;
  ASSETS?: AssetsFetcherLike;
  COMMUNITY_HASH_SALT?: string;
  OFFICIAL_COMMUNITY_URL?: string;
  NEXT_PUBLIC_OFFICIAL_COMMUNITY_READ_ONLY?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  OFFICIAL_TEXTURE_ORIGIN?: string;
  GITHUB_FEEDBACK_TOKEN?: string;
}

function applyWorkerEnv(env: WorkerEnv, ctx: ExecutionContextLike): void {
  if (env.COMMUNITY_HASH_SALT) {
    process.env.COMMUNITY_HASH_SALT = env.COMMUNITY_HASH_SALT;
  }
  if (env.OFFICIAL_COMMUNITY_URL) {
    process.env.OFFICIAL_COMMUNITY_URL = env.OFFICIAL_COMMUNITY_URL;
  }
  if (env.NEXT_PUBLIC_OFFICIAL_COMMUNITY_READ_ONLY) {
    process.env.NEXT_PUBLIC_OFFICIAL_COMMUNITY_READ_ONLY =
      env.NEXT_PUBLIC_OFFICIAL_COMMUNITY_READ_ONLY;
  }
  if (env.NEXT_PUBLIC_SITE_URL) {
    process.env.NEXT_PUBLIC_SITE_URL = env.NEXT_PUBLIC_SITE_URL;
  }
  if (env.OFFICIAL_TEXTURE_ORIGIN) {
    process.env.OFFICIAL_TEXTURE_ORIGIN = env.OFFICIAL_TEXTURE_ORIGIN;
  }
  if (env.GITHUB_FEEDBACK_TOKEN) {
    process.env.GITHUB_FEEDBACK_TOKEN = env.GITHUB_FEEDBACK_TOKEN;
  }
  setCloudflareRuntimeBindings({
    DB: env.DB,
    DATASET_BUCKET: env.DATASET_BUCKET,
    ASSETS: env.ASSETS,
    ctx,
    OFFICIAL_TEXTURE_ORIGIN: env.OFFICIAL_TEXTURE_ORIGIN,
  });
}

const params = <T extends Record<string, unknown>>(value: T) => ({
  params: Promise.resolve(value),
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handlePlanCard(request: Request, planId: string): Promise<Response> {
  const fallback = () => Response.redirect(new URL("/opengraph-image.png", request.url).toString(), 302);
  if (isOfficialCommunity()) {
    const id = officialPlanId(planId);
    if (!id) {
      return fallback();
    }
    try {
      const upstream = await fetchOfficialCommunity(`/api/community/plans/${id}/card`);
      if (!upstream.ok) {
        return fallback();
      }
      return new Response(await upstream.arrayBuffer(), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch {
      return fallback();
    }
  }
  return fallback();
}

async function handleApiRoute(request: Request, url: URL, env: WorkerEnv): Promise<Response | undefined> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/api/version" && method === "GET") {
    return versionRoute.GET();
  }

  let m: RegExpExecArray | null;

  if ((m = /^\/api\/highs\/([^/]+)$/.exec(path)) && method === "GET") {
    const file = decodeURIComponent(m[1]!);
    if (file !== "highs.js" && file !== "highs.wasm") {
      return new Response("Not found", { status: 404 });
    }
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(new Request(`https://assets.local/${file}`));
      if (assetRes.ok) {
        return new Response(assetRes.body, {
          status: 200,
          headers: {
            "content-type":
              file === "highs.wasm" ? "application/wasm" : "text/javascript; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      }
    }
    return new Response("Not found", { status: 404 });
  }

  // Dataset API routes
  if ((m = /^\/api\/datasets\/([^/]+)\/prewarm$/.exec(path))) {
    return new Response("Not found", { status: 404 });
  }
  if ((m = /^\/api\/datasets\/([^/]+)\/catalog$/.exec(path)) && method === "GET") {
    return datasetCatalogRoute.GET(request, params({ versionId: decodeURIComponent(m[1]!) }));
  }
  if ((m = /^\/api\/datasets\/([^/]+)\/resources$/.exec(path)) && method === "GET") {
    return datasetResourcesRoute.GET(request, params({ versionId: decodeURIComponent(m[1]!) }));
  }
  if ((m = /^\/api\/datasets\/([^/]+)\/recipes$/.exec(path)) && method === "GET") {
    return datasetRecipesRoute.GET(request, params({ versionId: decodeURIComponent(m[1]!) }));
  }
  if ((m = /^\/api\/datasets\/([^/]+)\/recipes\/([^/]+)$/.exec(path)) && method === "GET") {
    return datasetRecipeDetailRoute.GET(
      request,
      params({
        versionId: decodeURIComponent(m[1]!),
        recipeId: decodeURIComponent(m[2]!),
      }),
    );
  }
  if ((m = /^\/api\/datasets\/([^/]+)\/recipe-ids$/.exec(path)) && method === "GET") {
    return datasetRecipeIdsRoute.GET(request, params({ versionId: decodeURIComponent(m[1]!) }));
  }
  if ((m = /^\/api\/datasets\/([^/]+)\/resolve-recipes$/.exec(path)) && method === "POST") {
    return datasetResolveRecipesRoute.POST(
      request,
      params({ versionId: decodeURIComponent(m[1]!) }),
    );
  }
  if ((m = /^\/api\/datasets\/([^/]+)\/crops$/.exec(path)) && method === "GET") {
    return datasetCropsRoute.GET(request, params({ versionId: decodeURIComponent(m[1]!) }));
  }
  if ((m = /^\/api\/datasets\/([^/]+)\/mobs$/.exec(path)) && method === "GET") {
    return datasetMobsRoute.GET(request, params({ versionId: decodeURIComponent(m[1]!) }));
  }

  // Accounts & Auth routes
  if (path === "/api/accounts/search" && method === "GET") {
    return accountsSearchRoute.GET(request);
  }
  if (path === "/api/community/auth/login" && method === "POST") {
    return authLoginRoute.POST(request);
  }
  if (path === "/api/community/auth/logout" && method === "POST") {
    return authLogoutRoute.POST();
  }
  if (path === "/api/community/auth/me" && method === "GET") {
    return authMeRoute.GET(request);
  }
  if (path === "/api/community/auth/register" && method === "POST") {
    return authRegisterRoute.POST(request);
  }

  // Community routes
  if (path === "/api/community/images" && method === "POST") {
    return communityImagesRoute.POST(request);
  }
  if (path === "/api/community/plans") {
    if (method === "GET") return communityPlansRoute.GET(request);
    if (method === "POST") return communityPlansRoute.POST(request);
  }
  if ((m = /^\/api\/community\/plans\/([^/]+)$/.exec(path))) {
    const p = params({ planId: decodeURIComponent(m[1]!) });
    if (method === "GET") return communityPlanDetailRoute.GET(request, p);
    if (method === "PUT") return communityPlanDetailRoute.PUT(request, p);
    if (method === "DELETE") return communityPlanDetailRoute.DELETE(request, p);
  }
  if ((m = /^\/api\/community\/plans\/([^/]+)\/download$/.exec(path)) && method === "POST") {
    return communityPlanDownloadRoute.POST(request, params({ planId: decodeURIComponent(m[1]!) }));
  }
  if ((m = /^\/api\/community\/plans\/([^/]+)\/preview$/.exec(path))) {
    const p = params({ planId: decodeURIComponent(m[1]!) });
    if (method === "GET") return communityPlanPreviewRoute.GET(request, p);
    if (method === "POST") return communityPlanPreviewRoute.POST(request, p);
  }
  if ((m = /^\/api\/community\/plans\/([^/]+)\/card$/.exec(path)) && method === "GET") {
    return handlePlanCard(request, decodeURIComponent(m[1]!));
  }
  if ((m = /^\/api\/community\/plans\/([^/]+)\/vote$/.exec(path)) && method === "POST") {
    return communityPlanVoteRoute.POST(request, params({ planId: decodeURIComponent(m[1]!) }));
  }
  if ((m = /^\/api\/community\/plans\/([^/]+)\/comments$/.exec(path))) {
    const p = params({ planId: decodeURIComponent(m[1]!) });
    if (method === "GET") return communityPlanCommentsRoute.GET(request, p);
    if (method === "POST") return communityPlanCommentsRoute.POST(request, p);
  }
  if ((m = /^\/api\/community\/plans\/([^/]+)\/comments\/([^/]+)$/.exec(path)) && method === "DELETE") {
    return communityPlanCommentDetailRoute.DELETE(
      request,
      params({
        planId: decodeURIComponent(m[1]!),
        commentId: decodeURIComponent(m[2]!),
      }),
    );
  }

  // Library routes
  if (path === "/api/library" && method === "GET") {
    return libraryRoute.GET(request);
  }
  if ((m = /^\/api\/library\/designs\/([^/]+)$/.exec(path))) {
    const p = params({ designId: decodeURIComponent(m[1]!) });
    if (method === "GET") return libraryDesignRoute.GET(request, p);
    if (method === "PUT") return libraryDesignRoute.PUT(request, p);
    if (method === "DELETE") return libraryDesignRoute.DELETE(request, p);
  }
  if ((m = /^\/api\/library\/designs\/([^/]+)\/members$/.exec(path)) && method === "GET") {
    return libraryDesignMembersRoute.GET(request, params({ designId: decodeURIComponent(m[1]!) }));
  }
  if ((m = /^\/api\/library\/designs\/([^/]+)\/members\/([^/]+)$/.exec(path))) {
    const p = params({
      designId: decodeURIComponent(m[1]!),
      userId: decodeURIComponent(m[2]!),
    });
    if (method === "PUT") return libraryDesignMemberDetailRoute.PUT(request, p);
    if (method === "DELETE") return libraryDesignMemberDetailRoute.DELETE(request, p);
  }
  if ((m = /^\/api\/library\/folders\/([^/]+)$/.exec(path))) {
    const p = params({ folderId: decodeURIComponent(m[1]!) });
    if (method === "PUT") return libraryFolderRoute.PUT(request, p);
    if (method === "DELETE") return libraryFolderRoute.DELETE(request, p);
  }

  // Blueprints routes
  if (path === "/api/blueprints") {
    if (method === "GET") return blueprintsRoute.GET(request);
    if (method === "POST") return blueprintsRoute.POST(request);
  }
  if ((m = /^\/api\/blueprints\/([^/]+)$/.exec(path))) {
    const p = params({ blueprintId: decodeURIComponent(m[1]!) });
    if (method === "GET") return blueprintDetailRoute.GET(request, p);
    if (method === "PUT") return blueprintDetailRoute.PUT(request, p);
    if (method === "DELETE") return blueprintDetailRoute.DELETE(request, p);
  }
  if ((m = /^\/api\/blueprints\/([^/]+)\/download$/.exec(path)) && method === "POST") {
    return blueprintDownloadRoute.POST(request, params({ blueprintId: decodeURIComponent(m[1]!) }));
  }
  if ((m = /^\/api\/blueprints\/([^/]+)\/publish$/.exec(path)) && method === "POST") {
    return blueprintPublishRoute.POST(request, params({ blueprintId: decodeURIComponent(m[1]!) }));
  }
  if ((m = /^\/api\/blueprints\/([^/]+)\/vote$/.exec(path)) && method === "POST") {
    return blueprintVoteRoute.POST(request, params({ blueprintId: decodeURIComponent(m[1]!) }));
  }

  // Feedback routes
  if (path === "/api/feedback" && method === "POST") {
    return feedbackRoute.POST(request);
  }
  if ((m = /^\/api\/feedback\/files\/([^/]+)\/([^/]+)$/.exec(path)) && method === "GET") {
    return feedbackFileRoute.GET(
      request,
      params({
        reportId: decodeURIComponent(m[1]!),
        file: decodeURIComponent(m[2]!),
      }),
    );
  }

  return undefined;
}

const workerHandler = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContextLike): Promise<Response> {
    applyWorkerEnv(env, ctx);
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Handle /api/*
    if (path.startsWith("/api/")) {
      const apiResponse = await handleApiRoute(request, url, env);
      if (apiResponse) {
        return apiResponse;
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (path === "/announce/in-game-trailer.mp4") {
      return Response.redirect("https://gtnhplanner.com/announce/in-game-trailer.mp4", 302);
    }

    // 2. Handle dataset textures with fallback to gtnhplanner.com + R2/KV caching
    const texMatch = /^\/datasets\/gtnh\/([^/]+)\/textures\/(.+)$/.exec(path);
    if (texMatch && (request.method === "GET" || request.method === "HEAD")) {
      return serveDatasetTextureWithFallback(`${texMatch[1]}/textures/${texMatch[2]}`);
    }

    // 3. Handle dataset shard / manifest / partition requests
    if (path.startsWith("/datasets/gtnh/") && (request.method === "GET" || request.method === "HEAD")) {
      const rel = path.slice("/datasets/gtnh/".length);
      const bytes = await readDatasetBytes(rel);
      if (bytes) {
        return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), {
          status: 200,
          headers: {
            "Content-Type": path.endsWith(".gz") ? "application/gzip" : "application/json",
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
      return Response.json({ error: "Dataset file not found." }, { status: 404 });
    }

    // 4. Metadata & Legacy Redirect Routes
    if (path === "/community") {
      const plan = url.searchParams.get("plan");
      const dest = plan ? `/?plan=${encodeURIComponent(plan)}` : "/";
      return Response.redirect(new URL(dest, request.url).toString(), 307);
    }

    if (path === "/llms.txt" && request.method === "GET") {
      return llmsRoute.GET();
    }

    if (path === "/manifest.webmanifest" && request.method === "GET") {
      return Response.json(manifestRoute(), {
        headers: { "Cache-Control": "public, max-age=3600" },
      });
    }

    if (path === "/robots.txt" && request.method === "GET") {
      const r = robotsRoute();
      const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
      const allow = [rule?.allow ?? []].flat();
      const disallow = [rule?.disallow ?? []].flat();
      const text = [
        `User-Agent: ${rule?.userAgent ?? "*"}`,
        ...allow.map((a) => `Allow: ${a}`),
        ...disallow.map((d) => `Disallow: ${d}`),
        "",
        `Sitemap: ${r.sitemap}`,
        "",
      ].join("\n");
      return new Response(text, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (path === "/sitemap.xml" && request.method === "GET") {
      const items = await sitemapRoute();
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...items.map(
          (item) =>
            `<url><loc>${escapeHtml(item.url)}</loc>${item.lastModified ? `<lastmod>${new Date(item.lastModified).toISOString()}</lastmod>` : ""}</url>`,
        ),
        "</urlset>",
      ].join("\n");
      return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    }

    // 5. Home page with dynamic ?plan=<id> OpenGraph metadata injection
    if ((path === "/" || path === "/index.html") && env.ASSETS) {
      const htmlRes = await env.ASSETS.fetch(new Request("https://assets.local/index.html"));
      if (htmlRes.ok) {
        const planId = url.searchParams.get("plan");
        if (planId) {
          const row = await getPublicPlanRow(planId);
          if (row) {
            let html = await htmlRes.text();
            const desc = escapeHtml(describePlanRow(row));
            const title = escapeHtml(`${row.name} | GTNH Planner`);
            const cardUrl = `/api/community/plans/${encodeURIComponent(row.id)}/card`;
            html = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
            html = html.replace(
              "</head>",
              `<meta property="og:title" content="${escapeHtml(row.name)}"/><meta property="og:description" content="${desc}"/><meta property="og:image" content="${cardUrl}"/><meta name="twitter:title" content="${escapeHtml(row.name)}"/><meta name="twitter:description" content="${desc}"/><meta name="twitter:image" content="${cardUrl}"/></head>`,
            );
            return new Response(html, {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
              },
            });
          }
        }
        return new Response(htmlRes.body, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      }
    }

    // 6. Delegate all other static files (/_next/static/*, fonts, icons, etc.) to ASSETS
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

export default workerHandler;
