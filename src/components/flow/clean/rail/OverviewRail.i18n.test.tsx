// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { mockLeftovers, mockUnneeded } from "@/lib/solver/plan/__fixtures__/mock-extras";
import type { FactoryProject, ThroughputResult } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { setLocale } from "@/lib/i18n/locale";
import { OverviewRail } from "./OverviewRail";
import { PlanNoticeStack } from "./NoticeBar";
import { resetRailViewForTests } from "./rail-view";

vi.mock("@/lib/compact-view", () => ({ isCompactViewport: () => false }));

const solver = vi.hoisted(() => ({ answer: undefined as undefined | ThroughputResult }));
vi.mock("@/store/solve-books", async (original) => {
  const real = await original<typeof import("@/store/solve-books")>();
  return {
    ...real,
    solveBooks: (project: FactoryProject): ThroughputResult => solver.answer ?? real.solveBooks(project),
  };
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  window.localStorage.clear();
  resetRailViewForTests();
});

afterEach(() => {
  cleanup();
  setLocale("en");
});

function load(mock: typeof mockLeftovers, result: ThroughputResult = mock.result) {
  solver.answer = result;
  useFactoryStore.setState({
    project: mock.project,
    lastResult: result,
    isReadOnly: false,
    undoHistory: [],
    redoHistory: [],
  });
}

/** The displayed text of the four section bars, in order. */
const titles = (container: HTMLElement) =>
  [...container.querySelectorAll(".rail-sec-title")].map((e) => e.textContent);

it("renders the overview's section headings and power toggle through the dictionary", () => {
  load(mockLeftovers);
  const { container } = render(<OverviewRail />);
  expect(titles(container)).toEqual(["INPUTS", "OUTPUTS", "INTERNAL", "MACHINES"]);

  act(() => setLocale("zh-CN"));
  expect(titles(container)).toEqual(["输入", "输出", "内部", "机器"]);
  // The MACHINES bar's power toggle: the word, not the number beside it.
  expect([...container.querySelectorAll(".rail-sec-end")].some((e) => e.textContent?.endsWith("平均"))).toBe(
    true,
  );
  expect(screen.queryByText("Avg")).toBeNull();

  act(() => setLocale("en"));
  expect(titles(container)).toEqual(["INPUTS", "OUTPUTS", "INTERNAL", "MACHINES"]);
});

it("renders the empty machines line through the dictionary", () => {
  load({ ...mockLeftovers, project: { ...mockLeftovers.project, nodes: [], edges: [], storages: [] } });
  render(<OverviewRail />);
  expect(screen.getByText("No machines yet.")).toBeTruthy();

  act(() => setLocale("zh-CN"));
  expect(screen.getByText("还没有机器。")).toBeTruthy();
  expect(screen.queryByText("No machines yet.")).toBeNull();
});

it("renders the no-pin verdict notice through the dictionary", () => {
  const verdict = "Nothing to calculate yet: set a rate on a drawer, or pin a machine count";
  load(mockUnneeded, {
    ...mockUnneeded.result,
    plan: { ...mockUnneeded.result.plan!, failure: { message: "NO_PIN", args: [] }, notes: [] },
  });
  render(<PlanNoticeStack />);
  expect(screen.getByText(verdict)).toBeTruthy();

  act(() => setLocale("zh-CN"));
  expect(screen.getByText("还没有可计算的内容：在抽屉上设置速率，或钉选机器数量")).toBeTruthy();
  expect(screen.queryByText(verdict)).toBeNull();
});
