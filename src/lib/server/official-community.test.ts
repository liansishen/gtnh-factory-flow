// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as listPlans, POST as uploadPlan } from "@/app/api/community/plans/route";
import { POST as downloadPlan } from "@/app/api/community/plans/[planId]/download/route";
import {
  isOfficialCommunity,
  officialListQuery,
  officialPlanId,
} from "./official-community";

const PLAN_ID = "e1819cc8-b9a4-4905-89b2-05d36af5b6bb";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("official community routing", () => {
  it("accepts plan UUIDs and refuses anything that could walk the upstream path", () => {
    expect(officialPlanId(PLAN_ID)).toBe(PLAN_ID);
    expect(officialPlanId("../../etc/passwd")).toBeUndefined();
    expect(officialPlanId("")).toBeUndefined();
  });

  it("forwards only the list parameters the official API reads", () => {
    const query = officialListQuery(
      new URL(
        `http://local/api/community/plans?sort=top&pageSize=5&mine=1&deviceId=device&makes=item:steel&search=steel`,
      ),
    );
    expect(query).toBe("sort=top&search=steel&makes=item%3Asteel&pageSize=5");
  });

  it("only turns on when the deployment names an official base URL", () => {
    expect(isOfficialCommunity()).toBe(false);
    vi.stubEnv("OFFICIAL_COMMUNITY_URL", "https://official.test/");
    expect(isOfficialCommunity()).toBe(true);
  });

  it("proxies the public list and leaves Mine empty", async () => {
    vi.stubEnv("OFFICIAL_COMMUNITY_URL", "https://official.test");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ plans: [], total: 0, page: 1, pageSize: 5, gameVersions: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await listPlans(
      new Request("http://local/api/community/plans?sort=top&pageSize=5"),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://official.test/api/community/plans?sort=top&pageSize=5",
      expect.objectContaining({ cache: "no-store" }),
    );

    const mine = await listPlans(new Request("http://local/api/community/plans?mine=1"));
    expect(await mine.json()).toEqual({
      plans: [],
      total: 0,
      page: 1,
      pageSize: 24,
      gameVersions: [],
    });
  });

  it("refuses posting and forwards a download as a read", async () => {
    vi.stubEnv("OFFICIAL_COMMUNITY_URL", "https://official.test");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: "Plan", plan: { nodes: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const refused = await uploadPlan(new Request("http://local/api/community/plans", { method: "POST" }));
    expect(refused.status).toBe(403);

    const response = await downloadPlan(
      new Request(`http://local/api/community/plans/${PLAN_ID}/download`, { method: "POST" }),
      { params: Promise.resolve({ planId: PLAN_ID }) },
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://official.test/api/community/plans/${PLAN_ID}/download`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
