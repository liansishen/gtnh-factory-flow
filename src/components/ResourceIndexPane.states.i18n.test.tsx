// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatasetVersion, RecipeDataset } from "@/lib/datasets";
import { setLocale } from "@/lib/i18n/locale";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIndexPane } from "./ResourceIndexPane";

const initial = useFactoryStore.getState();
const generatedAt = "2026-10-17T00:00:00.000Z";
const sourceInfo = { sourceId: "gtnh-oracle" as const, generatedAt };
const version: DatasetVersion = {
  id: "local-2.9.0-rc-2",
  gtnhVersion: "2.9.0-RC-2",
  channel: "stable",
  publishedAt: generatedAt,
  manifestPath: "/datasets/gtnh/manifest.json",
  recipeDatasetPath: "/datasets/gtnh/recipes.json.gz",
  sourceInfo,
};
const dataset: RecipeDataset = {
  schemaVersion: 1,
  datasetVersionId: version.id,
  gtnhVersion: version.gtnhVersion,
  sourceInfo,
  generatedAt,
  resources: [],
  recipes: [],
  recipeMaps: [],
  oreDictionary: {},
};
const fetchResources = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
  resources: [], total: 0, offset: 0, limit: 6, hasMore: false,
}), { status: 200, headers: { "Content-Type": "application/json" } }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  window.localStorage.clear();
  setLocale("en");
  useFactoryStore.setState({
    dataset,
    datasetManifest: { schemaVersion: 1, versions: [version] },
    selectedDatasetVersionId: version.id,
    project: { ...initial.project, nodes: [], recipes: [], edges: [] },
  });
  fetchResources.mockClear();
  vi.stubGlobal("fetch", fetchResources);
});
afterEach(() => {
  cleanup();
  setLocale("en");
  useFactoryStore.setState(initial);
  vi.unstubAllGlobals();
});

function mount() {
  render(<ResourceIndexPane search="龘靐齉" onSearchChange={vi.fn()} onBrowse={vi.fn()} />);
}

describe("resource search state messages", () => {
  it.each([
    [undefined, "No matching resource.", "没有匹配的资源。"],
    ["On this board", "Nothing placed on the board yet.", "画布上还没有放置任何东西。"],
    ["Grown by crops", "No crop grows that.", "没有作物能长出这个。"],
    ["Made by bees", "No bee makes that.", "没有蜜蜂能产出这个。"],
  ])("repaints the %s empty state in both languages", async (filter, english, chinese) => {
    mount();
    await screen.findByText("No matching resource.", { exact: true });
    if (filter) {
      fireEvent.click(screen.getByRole("button", { name: "Show and sort" }));
      fireEvent.click(screen.getByRole("menuitem", { name: filter }));
    }
    await screen.findByText(english, { exact: true });
    act(() => setLocale("zh-CN"));
    expect(screen.getByText(chinese, { exact: true })).toBeTruthy();
    act(() => setLocale("en"));
    expect(screen.getByText(english, { exact: true })).toBeTruthy();
    expect(fetchResources).toHaveBeenCalled();
    const url = new URL(String(fetchResources.mock.calls[0][0]));
    expect(url.pathname).toBe(`/api/datasets/${version.id}/resources`);
    expect(url.searchParams.get("query")).toBe("龘靐齉");
  });

  it("translates a query error through the real request/render path", async () => {
    fetchResources.mockRejectedValueOnce(new Error("Resource query failed."));
    mount();
    await screen.findByText("Resource query failed.", { exact: true });
    act(() => setLocale("zh-CN"));
    expect(screen.getByText("资源查询失败。", { exact: true })).toBeTruthy();
    act(() => setLocale("en"));
    expect(screen.getByText("Resource query failed.", { exact: true })).toBeTruthy();
  });

  it("keeps an unknown diagnostic readable through fallback", async () => {
    fetchResources.mockRejectedValueOnce(new Error("Dataset unavailable for test"));
    mount();
    await screen.findByText("Dataset unavailable for test", { exact: true });
    act(() => setLocale("zh-CN"));
    expect(screen.getByText("Dataset unavailable for test", { exact: true })).toBeTruthy();
  });
});

describe("resource filter menu localization", () => {
  it("translates the filter labels, menu name and composed tooltip", async () => {
    mount();
    await screen.findByText("No matching resource.", { exact: true });
    act(() => setLocale("zh-CN"));
    const menuButton = screen.getByRole("button", { name: "显示与排序" });
    expect(menuButton.getAttribute("title")).toBe("显示：全部资源；排序：最热门");
    fireEvent.click(menuButton);
    expect(screen.getByRole("menu", { name: "显示与排序" })).toBeTruthy();
    for (const label of ["全部资源", "仅物品", "仅流体", "在此画布上", "作物产出", "蜜蜂产出"]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(`^${label}(\\s*显示)?$`) })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("menuitem", { name: "作物产出" }));
    await screen.findByText("没有作物能长出这个。", { exact: true });
    expect(menuButton.getAttribute("title")).toBe("显示：作物产出；排序：最热门");
  });
});
