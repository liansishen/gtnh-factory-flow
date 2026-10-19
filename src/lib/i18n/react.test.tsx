// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_STORAGE_KEY, setLocale } from "./locale";
import { I18nText, LocaleRestore, useGameName, useLocale, useT } from "./react";

const gameName = vi.hoisted(() =>
  vi.fn((name: string, locale: string) => (locale === "zh-CN" ? `游戏:${name}` : name)),
);

vi.mock("./game-names", () => ({
  translateGameName: gameName,
  hasChinese: (value: string) => /[\u4e00-\u9fff]/.test(value),
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
  gameName.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("I18nText", () => {
  it("leaves English text exactly as the source wrote it", () => {
    render(
      <div data-testid="host">
        <I18nText>Arrange</I18nText>
      </div>,
    );
    expect(screen.getByTestId("host").textContent).toBe("Arrange");
  });

  it("renders a fragment, never a wrapper element", () => {
    setLocale("zh-CN");
    render(
      <div data-testid="host">
        <I18nText>Arrange</I18nText>
      </div>,
    );
    const host = screen.getByTestId("host");
    expect(host.textContent).toBe("自动整理");
    expect(host.childNodes).toHaveLength(1);
    expect(host.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  });

  it("translates string children and leaves elements and numbers alone", () => {
    setLocale("zh-CN");
    render(
      <div data-testid="host">
        <I18nText>
          {"Close"}
          <b>Arrange</b>
          {5}
        </I18nText>
      </div>,
    );
    const host = screen.getByTestId("host");
    expect(host.querySelector("b")?.textContent).toBe("Arrange");
    expect(host.textContent).toBe("关闭Arrange5");
  });

  it("asks the game dictionary only for a game label", () => {
    setLocale("zh-CN");
    render(
      <div data-testid="host">
        <I18nText game>Steel Plate</I18nText>
      </div>,
    );
    expect(gameName).toHaveBeenCalledWith("Steel Plate", "zh-CN");
    expect(screen.getByTestId("host").textContent).toBe("游戏:Steel Plate");
  });

  it("consults game names when a UI rule only rewrites voltage parentheses", () => {
    setLocale("zh-CN");
    render(<div data-testid="host"><I18nText game>Wrench (LV)</I18nText></div>);
    expect(gameName).toHaveBeenCalledWith("Wrench (LV)", "zh-CN");
    expect(screen.getByTestId("host").textContent).toBe("游戏:Wrench (LV)");
  });

  it("keeps translated UI messages and counts on mixed game-label surfaces", () => {
    setLocale("zh-CN");
    render(<div data-testid="host"><I18nText game>{["Power", "3 recipes"]}</I18nText></div>);
    expect(screen.getByTestId("host").textContent).toBe("发电3 个配方");
    expect(gameName).not.toHaveBeenCalled();
  });

  it("does not consult the game dictionary for UI copy", () => {
    setLocale("zh-CN");
    render(
      <div data-testid="host">
        <I18nText>Close</I18nText>
      </div>,
    );
    expect(gameName).not.toHaveBeenCalled();
    expect(screen.getByTestId("host").textContent).toBe("关闭");
  });
});

function Probe() {
  const t = useT();
  const locale = useLocale();
  return (
    <span data-testid="probe" data-locale={locale} title={t("Close")}>
      {t("Arrange")}
    </span>
  );
}

describe("useT and useLocale", () => {
  it("translate attributes and text for the active language", () => {
    setLocale("zh-CN");
    render(<Probe />);
    const probe = screen.getByTestId("probe");
    expect(probe.textContent).toBe("自动整理");
    expect(probe.getAttribute("title")).toBe("关闭");
    expect(probe.getAttribute("data-locale")).toBe("zh-CN");
  });
});

function GameLabelProbe() {
  const name = useGameName();
  return <span data-testid="game-label" aria-label={name("File (MV)")}>{name("File (MV)")}</span>;
}

it("uses the same game-name precedence for text and accessible labels across locale switches", () => {
  setLocale("en");
  render(<GameLabelProbe />);
  const label = screen.getByTestId("game-label");
  expect(label.textContent).toBe("File (MV)");
  act(() => setLocale("zh-CN"));
  expect(label.textContent).toBe("游戏:File (MV)");
  expect(label.getAttribute("aria-label")).toBe("游戏:File (MV)");
  act(() => setLocale("en"));
  expect(label.textContent).toBe("File (MV)");
  expect(label.getAttribute("aria-label")).toBe("File (MV)");
});

describe("switching the language", () => {
  it("repaints the tree in place, both ways", () => {
    render(
      <div data-testid="host">
        <I18nText>Arrange</I18nText>
      </div>,
    );
    expect(screen.getByTestId("host").textContent).toBe("Arrange");
    act(() => setLocale("zh-CN"));
    expect(screen.getByTestId("host").textContent).toBe("自动整理");
    act(() => setLocale("en"));
    expect(screen.getByTestId("host").textContent).toBe("Arrange");
  });
});

describe("LocaleRestore", () => {
  it("puts the saved language on <html lang> and follows a change", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    render(<LocaleRestore />);
    expect(document.documentElement.getAttribute("lang")).toBe("zh-CN");
    act(() => setLocale("en"));
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });

  it("leaves <html lang> at English when nothing is saved", () => {
    document.documentElement.setAttribute("lang", "en");
    render(<LocaleRestore />);
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });
});
