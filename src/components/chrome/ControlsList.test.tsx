// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDeviceSettingsForTests, writeDeviceSettings } from "@/lib/device-settings";
import { setLocale } from "@/lib/i18n/locale";
import { ControlsList } from "./ControlsList";
import { CHROME_SCREEN_K } from "./ChromeMenu";
import { getUiScale } from "@/lib/ui-scale";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  window.localStorage.clear();
  resetDeviceSettingsForTests();
  setLocale("en");
});
afterEach(() => { cleanup(); setLocale("en"); });

const gestures = () =>
  [...document.querySelectorAll(".mc-controls-key")].map((element) => element.textContent);
const effects = () =>
  [...document.querySelectorAll(".mc-controls-effect")].map((element) => element.textContent);

describe("the controls list in Chinese", () => {
  it("translates gesture phrases and effects", () => {
    setLocale("zh-CN");
    render(<ControlsList onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "画布如何运作" })).toBeTruthy();
    expect(gestures()).toContain("在物品上按 R 或 U");
    expect(gestures()).toContain("点击端口");
    expect(gestures()).toContain("滚轮");
    expect(gestures()).toContain("WASD 或方向键");
    expect(gestures()).not.toContain("Click a port");
    expect(effects()).toContain("清除速率");
    expect(effects()).toContain("复制、剪切、粘贴所选内容及其导线");
    expect(effects()).toContain("撤销、重做");
  });

  it("keeps Ctrl/R/U and keyboard key tokens readable", () => {
    setLocale("zh-CN");
    render(<ControlsList onClose={vi.fn()} />);
    // Chords and the Delete key are the key itself, not a phrase: shown verbatim.
    expect(gestures()).toContain("Ctrl+A");
    expect(gestures()).toContain("Delete");
    expect(gestures()).toContain("Ctrl+C, Ctrl+X, Ctrl+V");
    expect(gestures()).toContain("Ctrl+Z, Ctrl+Shift+Z");
    // Tokens inside a translated phrase survive.
    expect(gestures()).toContain("在物品上按 R 或 U");
    expect(effects()).toContain("平移（+/- 或 Page Up/Down 缩放）");
  });

  it("translates the wheel row, and shows only Zoom when Scroll changes values is off", () => {
    setLocale("zh-CN");
    const { unmount } = render(<ControlsList onClose={vi.fn()} />);
    expect(effects()).toContain("缩放；在数值上滚动可修改");
    unmount();
    writeDeviceSettings({ scrollChangesValues: false });
    render(<ControlsList onClose={vi.fn()} />);
    expect(effects()).toContain("缩放");
  });

  it("keeps the English source in English mode", () => {
    render(<ControlsList onClose={vi.fn()} />);
    expect(gestures()).toContain("Click a port");
    expect(effects()).toContain("Clear the rate");
  });

  it("keeps the real menu coordinates within a phone viewport when Help wraps", () => {
    const width = Object.getOwnPropertyDescriptor(window, "innerWidth")!;
    const height = Object.getOwnPropertyDescriptor(window, "innerHeight")!;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    const key = document.createElement("div");
    key.className = "mb-key";
    key.dataset.mb = "help";
    key.getBoundingClientRect = () => ({ left: 150, right: 182, top: 70, bottom: 100, x: 150, y: 70, width: 32, height: 30, toJSON: () => ({}) });
    document.body.append(key);
    try {
      render(<ControlsList onClose={vi.fn()} />);
      const dialog = screen.getByRole("dialog");
      const scale = getUiScale() * CHROME_SCREEN_K;
      const left = window.innerWidth - (parseFloat(dialog.style.width) + parseFloat(dialog.style.right)) * scale;
      expect(left).toBeGreaterThanOrEqual(7.9);
      expect(parseFloat(dialog.style.right) * scale).toBeGreaterThanOrEqual(7.9);
      expect(parseFloat(dialog.style.top) * scale).toBeGreaterThanOrEqual(103.9);
      expect(parseFloat(dialog.style.maxHeight)).toBeGreaterThan(0);
    } finally {
      key.remove();
      Object.defineProperty(window, "innerWidth", width);
      Object.defineProperty(window, "innerHeight", height);
    }
  });
});
