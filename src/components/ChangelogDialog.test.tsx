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
    expect(screen.getByText("官方 4.4.3 更新")).toBeTruthy();
    expect(
      screen.getByText("机器数量现在统一使用“任意”“至多”和“恰好”；清除数量后会回到“任意”。"),
    ).toBeTruthy();
    expect(screen.getByText("机器数量像抽屉一样工作")).toBeTruthy();
    expect(
      screen.getByText(
        "未设置数量的机器现在显示“任意”：由方案决定数量。选择“任意”后不会再跳回“至多”。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("不再有看不见的连线")).toBeTruthy();
    expect(
      screen.getByText(
        "修复了方案几乎不运行某张卡片、却仍在使用它时，其连线消失的问题。现在该卡片的行和连线会保留在画布上。",
      ),
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
