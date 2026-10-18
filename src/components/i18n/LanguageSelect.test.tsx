// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n/locale";
import { LanguageSelect } from "./LanguageSelect";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  cleanup();
});

describe("LanguageSelect", () => {
  it("carries a bilingual label and offers English and 简体中文", () => {
    render(<LanguageSelect />);
    const select = screen.getByLabelText("Language / 语言") as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(["English", "简体中文"]);
    expect([...select.options].map((option) => option.value)).toEqual(["en", "zh-CN"]);
  });

  it("persists the choice when the player picks one", () => {
    render(<LanguageSelect />);
    const select = screen.getByLabelText("Language / 语言") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "zh-CN" } });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(select.value).toBe("zh-CN");
  });
});
