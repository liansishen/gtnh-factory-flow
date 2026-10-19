// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignSummary } from "@/lib/designs/design-library";
import { setLocale } from "@/lib/i18n/locale";
import { useDesignStore } from "@/store/design-store";
import { TipPanel } from "@/components/flow/clean/interaction/TipPanel";
import { ModTabs } from "./ModTabs";

vi.mock("@/lib/compact-view", () => ({ isCompactViewport: () => false }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function design(id: string, name: string, extra: Partial<DesignSummary> = {}): DesignSummary {
  return {
    id,
    name,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

const actions = {
  switchToDesign: vi.fn(async () => undefined),
  addDesign: vi.fn(async () => undefined),
  closeDesigns: vi.fn(async () => undefined),
  removeDesign: vi.fn(async () => undefined),
  renameDesign: vi.fn(async () => undefined),
  reorderDesigns: vi.fn(async () => undefined),
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  for (const fn of Object.values(actions)) fn.mockClear();
  useDesignStore.setState({
    designs: [design("a", "Benzene"), design("b", "ref-chain")],
    publicViews: [],
    publicView: undefined,
    activeDesignId: "b",
    ...actions,
  });
});

afterEach(() => {
  cleanup();
  setLocale("en");
});

const props = { onPaste: vi.fn(), onShare: vi.fn() };
const rows = () =>
  [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(
    (element) => element.textContent,
  );

describe("the plan tabs' menus in Chinese", () => {
  it("right-click opens the mod's rows in Chinese, keeping the plan's own name as typed", () => {
    setLocale("zh-CN");
    render(<ModTabs {...props} />);
    fireEvent.contextMenu(screen.getByText("ref-chain"));
    expect(rows()).toEqual([
      "重命名",
      "复制方案代码用于粘贴或分享",
      "向社区发布副本…供其他玩家使用",
      "关闭标签页保留在“我的方案”中",
      "关闭其他标签页保留在“我的方案”中",
      "删除方案",
    ]);
    // The menu's accessible name is the translated words round the player's own plan name.
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe(
      "方案选项： ref-chain",
    );
  });

  it("asks before deleting in Chinese, and the plan's name stays verbatim", () => {
    setLocale("zh-CN");
    render(<ModTabs {...props} />);
    fireEvent.contextMenu(screen.getByText("ref-chain"));
    fireEvent.click(screen.getByText("删除方案"));
    expect(document.querySelector(".mm-title")?.textContent).toBe("删除 'ref-chain' 确定吗？");
    expect(rows()).toEqual(["删除", "保留"]);
    fireEvent.click(screen.getByText("删除"));
    expect(actions.removeDesign).toHaveBeenCalledWith("b");
  });

  it("the + menu is in Chinese", () => {
    setLocale("zh-CN");
    render(<ModTabs {...props} />);
    fireEvent.click(screen.getByLabelText("新建方案"));
    expect(rows()).toEqual([
      "新建方案",
      "打开方案…我的方案",
      "打开方案文件….json",
      "粘贴方案方案链接、代码或文件",
      "浏览社区公开方案",
    ]);
  });

  it("reads the tabs' tips in Chinese, the plan's own name kept verbatim", () => {
    render(<ModTabs {...props} />);
    const tab = screen.getByText("Benzene").closest(".mt-tab")!;
    const spec = JSON.parse(tab.getAttribute("data-tip")!) as {
      id: string;
      title: string;
      sub: string;
      verbatimTitle?: boolean;
    };
    // The element carries the source strings; the tip host translates them where it draws them.
    expect(spec).toMatchObject({
      title: "Benzene",
      sub: "Middle-click to close, right-click for more",
      verbatimTitle: true,
    });
    act(() => setLocale("zh-CN"));
    render(<TipPanel spec={spec} />);
    expect(document.querySelector(".tp-title")?.textContent).toBe("Benzene");
    expect(document.querySelector(".tp-sub")?.textContent).toBe(
      "中键点击关闭，右键点击查看更多操作",
    );
    expect(screen.getByLabelText("关闭 Benzene")).toBeTruthy();
    const plus = JSON.parse(screen.getByLabelText("新建方案").getAttribute("data-tip")!) as {
      id: string;
      title: string;
    };
    cleanup();
    act(() => setLocale("en"));
    render(<TipPanel spec={plus} />);
    expect(document.querySelector(".tp-title")?.textContent).toBe(
      "New plan, or open an existing one",
    );
  });
});
