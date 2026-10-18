// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { ModPick } from "./ModPick";

afterEach(() => { cleanup(); setLocale("en"); });

it("localizes the selected label and menu without changing option values", () => {
  const onChange = vi.fn();
  render(<ModPick value="all" label="Maximum machine tier" title="Maximum machine tier" options={[{ value: "all", label: "All tiers" }, { value: "LV", label: "LV" }]} onChange={onChange} />);
  expect(screen.getByRole("button", { name: "Maximum machine tier" }).textContent).toBe("All tiers");
  act(() => setLocale("zh-CN"));
  const control = screen.getByRole("button", { name: "最高机器等级" });
  expect(control.textContent).toBe("所有等级");
  expect(control.getAttribute("title")).toBe("最高机器等级");
  fireEvent.click(control);
  expect(screen.getByRole("menuitem", { name: "所有等级" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "LV" }));
  expect(onChange).toHaveBeenCalledWith("LV");
  act(() => setLocale("en"));
  expect(screen.getByRole("button", { name: "Maximum machine tier" }).textContent).toBe("All tiers");
});
