// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { MenuItem } from "./library-menu";

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

describe("a plan's menu row", () => {
  it("shows the row's words in English by default", () => {
    render(<MenuItem label="Open" onClick={vi.fn()} />);
    expect(screen.getByRole("menuitem").textContent).toBe("Open");
  });

  it("translates the row's words when the language is Chinese", () => {
    setLocale("zh-CN");
    render(<MenuItem label="Open" onClick={vi.fn()} />);
    expect(screen.getByRole("menuitem").textContent).toBe("打开");
  });
});
