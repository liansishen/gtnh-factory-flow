// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { BarKey } from "./bar-parts";

afterEach(() => { cleanup(); setLocale("en"); });

describe("localized planner navigation", () => {
  it("switches the actual navigation key's label and accessible name in place", () => {
    const action = vi.fn();
    render(<BarKey id="plans" label="Plans" tip="Plans" onClick={action} />);
    const key = screen.getByRole("button", { name: "Plans" });
    act(() => setLocale("zh-CN"));
    expect(screen.getByRole("button", { name: "方案库" })).toBe(key);
    expect(key.textContent).toBe("方案库");
    fireEvent.click(key);
    expect(action).toHaveBeenCalledTimes(1);
    act(() => setLocale("en"));
    expect(screen.getByRole("button", { name: "Plans" })).toBe(key);
  });

  it("preserves an account's custom child content", () => {
    render(<BarKey id="account" ariaLabel="Account: Steel Plate" tip="Account" onClick={() => {}}><span>Steel Plate</span></BarKey>);
    act(() => setLocale("zh-CN"));
    expect(screen.getByText("Steel Plate")).toBeTruthy();
    expect(screen.queryByText("钢板")).toBeNull();
  });
});
