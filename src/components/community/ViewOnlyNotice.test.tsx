// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { ViewOnlyNotice } from "./ViewOnlyNotice";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  window.localStorage.clear();
  setLocale("en");
});
afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("a shared plan's view-only notice", () => {
  it("reads its copy in English by default", () => {
    render(<ViewOnlyNotice />);
    expect(screen.getByText("View only")).toBeTruthy();
    expect(screen.getByText("Make a copy")).toBeTruthy();
  });

  it("repaints every application string in the chosen language", () => {
    setLocale("zh-CN");
    render(<ViewOnlyNotice />);
    expect(screen.getByText("仅查看")).toBeTruthy();
    expect(
      screen.getByText("此共享方案为仅查看。复制一份即可添加机器、连接物品或更改设置。"),
    ).toBeTruthy();
    expect(screen.getByText("复制一份")).toBeTruthy();
    expect(screen.queryByText("Make a copy")).toBeNull();
  });
});
