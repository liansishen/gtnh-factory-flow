// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { MinimapSettingsRows } from "./MinimapSettingsPanel";
import { DEFAULT_MINIMAP, getMinimap, setMinimap } from "./minimap-settings";

afterEach(() => { cleanup(); setLocale("en"); setMinimap(DEFAULT_MINIMAP); });

it("translates minimap choices in both shared settings surfaces while retaining canonical values", () => {
  setMinimap(DEFAULT_MINIMAP);
  render(<MinimapSettingsRows />);
  expect(screen.getByRole("radio", { name: "Small" })).toBeTruthy();
  act(() => setLocale("zh-CN"));
  fireEvent.click(screen.getByRole("radio", { name: "中型" }));
  fireEvent.click(screen.getByRole("radio", { name: "左上" }));
  fireEvent.click(screen.getByRole("radio", { name: "方形" }));
  expect(getMinimap()).toMatchObject({ size: "medium", corner: "top-left", shape: "square" });
  expect(screen.getByText("左上")).toBeTruthy();
  act(() => setLocale("en"));
  expect(screen.getByRole("radio", { name: "Medium" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "Top left" }).getAttribute("aria-checked")).toBe("true");
});
