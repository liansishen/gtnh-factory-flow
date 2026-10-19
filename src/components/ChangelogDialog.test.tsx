// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANGELOG } from "@/lib/changelog";
import { setLocale } from "@/lib/i18n/locale";
import { ChangelogDialog } from "./ChangelogDialog";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});
beforeEach(() => {
  window.localStorage.clear();
  setLocale("zh-CN");
});
afterEach(() => cleanup());

describe("the changelog in Chinese", () => {
  it("translates the newest three releases", () => {
    render(<ChangelogDialog onClose={vi.fn()} />);
    expect(screen.getByText("所有改动，最新的在最前。")).toBeTruthy();
    expect(screen.getByText("菜单与机器设置汉化补全")).toBeTruthy();
    expect(screen.getByText("版本号前三段对应官方版本，第四段记录本分支的发布次数。")).toBeTruthy();
    expect(screen.getByText("带电压等级的工具与机器名称汉化修复")).toBeTruthy();
    expect(screen.getByText("带电压等级的工具、机器外壳和组件现会完整显示中文名称。")).toBeTruthy();
    expect(screen.getByText("气锤名称在显示和搜索中现会保留正确的 LV、MV、HV 等级。")).toBeTruthy();
    expect(screen.getByText("中文和手机端提示显示修复")).toBeTruthy();
    expect(screen.getByText("工具栏和抽屉按钮的提示现会随界面语言切换。")).toBeTruthy();
    expect(screen.getByText("物品提示会隐藏原始 NBT 技术数据，配方和导出的方案仍保留完整数据。")).toBeTruthy();
  });

  it("translates the Full history count through the dynamic rule", () => {
    render(<ChangelogDialog onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: /完整历史/ });
    expect(button.textContent).toBe(`完整历史（更早的 ${CHANGELOG.length - 3} 个版本）`);
  });

  it("keeps translated and English older releases behind the history control", () => {
    render(<ChangelogDialog onClose={vi.fn()} />);
    expect(CHANGELOG.length - 3).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /完整历史/ }));
    expect(screen.getByText("在线规划器已迁至新地址")).toBeTruthy();
    expect(screen.getByText("在线规划器现已迁至 plan.playgtnh.dpdns.org。")).toBeTruthy();
    expect(screen.getByText("支持中文、英文和拼音搜索")).toBeTruthy();
    expect(screen.getByRole("link", { name: "翻译来源与许可" }).getAttribute("href")).toBe("/third-party-notices.txt");
    expect(screen.getByText("Reports from the mod are checked")).toBeTruthy();
    expect(screen.getByText("第 4 版：网页上的游戏内规划器，以及可共同编辑的方案")).toBeTruthy();
    expect(screen.getByText("最多：机器数量代表你拥有的数量")).toBeTruthy();
    expect(screen.getByText("机器数量现在默认为“最多”。机器会按产线允许的上限运行，绝不超过。")).toBeTruthy();
    expect(screen.getByText("选择缩小视图的起点")).toBeTruthy();
  });
});
