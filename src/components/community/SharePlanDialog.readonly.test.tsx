// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** The official community is a read-only source: no post can leave this build. */
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("NEXT_PUBLIC_OFFICIAL_COMMUNITY_READ_ONLY", "1");
});
afterAll(() => {
  vi.unstubAllEnvs();
  cleanup();
});

describe("official community read-only", () => {
  it("answers a posting request with the read-only notice", async () => {
    const { SharePlanDialog } = await import("./SharePlanDialog");
    await act(async () => {
      render(<SharePlanDialog onClose={() => undefined} />);
    });
    expect(screen.getByRole("dialog", { name: "Community posting is unavailable" })).toBeTruthy();
    expect(screen.getByText(/Official community plans are read-only here/)).toBeTruthy();
  });

  it("keeps posting rows out of the Share menu", async () => {
    const { libraryRows } = await import("@/components/chrome/library-rows");
    expect(libraryRows(false, () => undefined)).toEqual([]);
    expect(libraryRows(true, () => undefined)).toEqual([]);
  });
});
