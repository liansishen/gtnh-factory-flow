// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { useCommunityAuthStore } from "@/store/community-auth-store";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { useLiveSession } from "@/store/live-session";
import { writeWorkspaceView } from "@/lib/workspace-view";

const viewport = vi.hoisted(() => ({ compact: false }));
vi.mock("@/lib/compact-view", () => ({
  isCompactViewport: () => viewport.compact,
  useIsCompactViewport: () => viewport.compact,
}));
const modLink = vi.hoisted(() => ({
  findModGame: vi.fn(),
  localNetworkPermission: vi.fn(),
  sendPlanToMod: vi.fn(),
}));
vi.mock("@/lib/mod-link/mod-link", () => modLink);
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: vi.fn(async () => true) }));
vi.mock("@/lib/import-export/plan-code", async (original) => ({
  ...(await original<typeof import("@/lib/import-export/plan-code")>()),
  encodePlanCode: vi.fn(async () => "gtnh1.TEST"),
}));

// The bar carries the live state (and the invite row) only when the build has live plans.
vi.stubEnv("NEXT_PUBLIC_LIVE_URL", "wss://live.test");
const { ModBar } = await import("./ModBar");

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const noop = () => undefined;
const renderBar = () =>
  render(
    <ModBar
      onShare={noop}
      onScreenshot={noop}
      onSettings={noop}
      onChangelog={noop}
      onDevMenu={noop}
      unreadNotes={false}
    />,
  );
const key = (id: string) => document.querySelector<HTMLElement>(`[data-mb="${id}"]`)!;
const labels = () =>
  [...document.querySelectorAll('[role="menu"] [role="menuitem"] .mm-label')].map(
    (element) => element.textContent,
  );
const row = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find(
    (element) => element.querySelector(".mm-label")?.textContent === label,
  )!;

beforeEach(() => {
  vi.clearAllMocks();
  viewport.compact = false;
  modLink.localNetworkPermission.mockResolvedValue("unknown");
  modLink.findModGame.mockResolvedValue(undefined);
  modLink.sendPlanToMod.mockResolvedValue(false);
  window.localStorage.clear();
  useFactoryStore.setState({
    rateUnit: "second",
    powerDisplayUnit: "eu",
    undoHistory: [],
    redoHistory: [],
    isReadOnly: false,
  });
  useDesignStore.setState({ designs: [], publicViews: [], activeDesignId: undefined });
  useCommunityAuthStore.setState({ user: undefined, hasHydrated: true });
  useLiveSession.setState({ status: "off", present: [], pending: 0 });
  writeWorkspaceView({ averageMachineDraw: true });
});

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("the top bar's menus in Chinese", () => {
  it("opens the Share menu in Chinese, with the invite row's tip", async () => {
    setLocale("zh-CN");
    renderBar();
    await act(async () => {
      fireEvent.click(key("share"));
    });
    expect(labels()).toEqual([
      "邀请他人…",
      "复制方案链接",
      "复制方案代码",
      "导出方案文件",
      "截图…",
      "在游戏中打开",
      "向社区发布副本…",
    ]);
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe("分享此方案");
    const invite = row("邀请他人…");
    expect(invite.getAttribute("aria-disabled")).toBe("true");
    expect(JSON.parse(invite.getAttribute("data-tip")!).title).toBe("登录后可邀请他人");
    expect(JSON.parse(row("在游戏中打开").getAttribute("data-tip")!).title).toBe(
      "请先启动安装了 GTNH Planner 的游戏",
    );
  });

  it("opens the Help menu in Chinese", () => {
    setLocale("zh-CN");
    renderBar();
    fireEvent.click(key("help"));
    expect(labels()).toEqual([
      "查看操作引导",
      "操作与快捷键",
      "欢迎",
      "更新内容",
      "下载模组",
      "GitHub 源码",
      "Discord 讨论串",
      "在 Ko-fi 上支持",
    ]);
    expect(row("查看操作引导").querySelector(".mm-detail")?.textContent).toBe("3 分钟");
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe("帮助");
  });

  it("reads the live state's words in Chinese, the count and the faces' names kept", () => {
    useLiveSession.setState({
      status: "offline",
      pending: 3,
      present: [
        { id: "u1", username: "ann", color: "#22d3ee", client: "web", conn: "c1" },
        { id: "u2", username: "bo", color: "#f472b6", client: "game", conn: "c2" },
      ],
    });
    setLocale("zh-CN");
    renderBar();
    const live = document.querySelector<HTMLElement>(".mb-live")!;
    const tip = JSON.parse(live.getAttribute("data-tip")!) as {
      id: string;
      title: string;
      sub: string;
    };
    expect(tip.id).toBe("bar|live");
    expect(tip.title).toBe("离线：你的编辑保存在本地，恢复连接后会自动发送 (3 项待发送)");
    expect(tip.sub).toBe("当前在线: ann, bo");
    // The game's face says so in Chinese; the account's own name stays as typed.
    expect(live.querySelectorAll(".mb-face")[1].getAttribute("aria-label")).toBe("bo （游戏内）");
    act(() => setLocale("en"));
    const back = JSON.parse(live.getAttribute("data-tip")!) as { title: string };
    expect(back.title).toBe(
      "Offline: your edits are kept here and go when the connection is back (3 waiting)",
    );
  });
});
