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
    expect(screen.getByText("消耗提示与种子数量汉化")).toBeTruthy();
    expect(
      screen.getByText("输入消耗概率和资源名称说明现已翻译为中文。"),
    ).toBeTruthy();
    expect(
      screen.getByText("屏幕阅读器会用中文朗读种子数量及其“任意”“至多”“恰好”规则。"),
    ).toBeTruthy();
    expect(screen.getByText("官方 4.7.0 更新")).toBeTruthy();
    expect(
      screen.getByText("自动整理可以保留分组，也可以拆开所有分组后整理每张卡片，并优先减少导线交叉。"),
    ).toBeTruthy();
    expect(screen.getByText("自动整理可选择是否保留分组")).toBeTruthy();
    expect(
      screen.getByText("在带分组的方案上，自动整理会询问：保留分组，还是拆开全部分组后整理每张卡片。"),
    ).toBeTruthy();
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
    expect(screen.getByText("合适的“至多”数量现在可以求解")).toBeTruthy();
    expect(screen.getByText("树木、蜜蜂与树叶")).toBeTruthy();
    expect(screen.getByText("机器不再消失")).toBeTruthy();
    expect(screen.getByText("官方 4.4.3 更新")).toBeTruthy();
    expect(screen.getByText("大型发电方案重新可解")).toBeTruthy();
    expect(screen.getByText("画布更清晰，数量更明确")).toBeTruthy();
    expect(
      screen.getByText(
        "未设置数量的卡片现在显示“至多”而不是“任意”。你的数字没有改变：在你设置数量之前，方案仍会自行决定。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("在线规划器已迁至新地址")).toBeTruthy();
    expect(screen.getByText("在线规划器现已迁至 plan.playgtnh.dpdns.org。")).toBeTruthy();
    expect(screen.getByText("支持中文、英文和拼音搜索")).toBeTruthy();
    expect(screen.getByRole("link", { name: "翻译来源与许可" }).getAttribute("href")).toBe(
      "/third-party-notices.txt",
    );
    expect(screen.getByText("Reports from the mod are checked")).toBeTruthy();
    expect(screen.getByText("第 4 版：网页上的游戏内规划器，以及可共同编辑的方案")).toBeTruthy();
    expect(screen.getByText("最多：机器数量代表你拥有的数量")).toBeTruthy();
    expect(
      screen.getByText("机器数量现在默认为“最多”。机器会按产线允许的上限运行，绝不超过。"),
    ).toBeTruthy();
    expect(screen.getByText("选择缩小视图的起点")).toBeTruthy();
  });
});
