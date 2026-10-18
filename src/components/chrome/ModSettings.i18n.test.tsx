// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDeviceSettingsForTests } from "@/lib/device-settings";
import { setLocale } from "@/lib/i18n/locale";
import { ModSettings } from "./ModSettings";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  window.localStorage.clear();
  resetDeviceSettingsForTests();
  setLocale("zh-CN");
});
afterEach(() => cleanup());

const sections = () =>
  [...document.querySelectorAll(".ms-section")].map((element) => element.textContent);
const rowLabels = () =>
  [...document.querySelectorAll(".ms-row .ms-label")].map((element) => element.textContent);
const choiceNames = () =>
  [...document.querySelectorAll(".ms-choices .ms-choice")].map((element) => element.textContent);

describe("the settings box in Chinese", () => {
  it("translates the sections and the Board rows", () => {
    render(<ModSettings onClose={vi.fn()} />);
    expect(sections()).toEqual(["画布", "小地图", "声音", "操作", "语言"]);
    expect(rowLabels()).toEqual([
      "大小",
      "缩小时显示名称",
      "缩小视图",
      "问题描边",
      "滚轮修改数值",
      "物品浏览器",
      "字体",
    ]);
    expect(screen.getByText("（规划器）")).toBeTruthy();
    expect(screen.getByText("设置规划器的显示大小。")).toBeTruthy();
    expect(screen.getByText("在数字或标签上滚动即可修改。")).toBeTruthy();
  });

  it("translates the Sound rows and choices", () => {
    render(<ModSettings onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("声音"));
    expect(rowLabels()).toEqual(["声音"]);
    expect(screen.getByText("设置点击音效的音量。")).toBeTruthy();
    expect(
      [...document.querySelectorAll('[aria-label="声音"] .ms-choice')].map((e) => e.textContent),
    ).toEqual(["关闭", "安静", "常规", "响亮"]);
  });

  it("translates the Controls rows and buttons", () => {
    render(<ModSettings onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("操作"));
    expect(rowLabels()).toEqual(["操作与快捷键", "引导教程"]);
    expect(screen.getByText("打开按键列表。")).toBeTruthy();
    expect(screen.getByText("带你了解规划器。")).toBeTruthy();
    expect(choiceNames()).toEqual(["打开", "开始"]);
  });
});
