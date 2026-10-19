// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { translateMessage } from "@/lib/i18n/messages";
import { POWER_GROUPS } from "@/lib/power/registry";
import { useFactoryStore } from "@/store/factory-store";
import { PowerSourceOverlay } from "./PowerSourceOverlay";

vi.mock("@/lib/compact-view", () => ({
  useIsCompactViewport: () => true,
  isCompactViewport: () => true,
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const add = vi.fn();
beforeEach(() => {
  window.localStorage.clear();
  setLocale("zh-CN");
  add.mockClear();
  useFactoryStore.setState({ powerMenuOpen: true, addPowerSourceNode: add });
});
afterEach(() => {
  cleanup();
  useFactoryStore.setState({ powerMenuOpen: false });
  setLocale("en");
});

describe("the phone power picker in both languages", () => {
  it("translates groups and machine names and changes language while open", () => {
    render(<PowerSourceOverlay />);
    const types = screen.getByRole("combobox", { name: translateMessage("Power type", "zh-CN") });
    for (const group of POWER_GROUPS) {
      const label = translateMessage(group.name, "zh-CN");
      expect(label).toMatch(/[\u3400-\u9fff]/);
      expect(types.querySelector(`option[value="${group.id}"]`)?.textContent).toBe(label);
    }
    expect(document.querySelector('[data-source="gas-turbine"]')?.textContent).toContain("燃气涡轮");
    fireEvent.change(types, { target: { value: "burners" } });
    expect(document.querySelector('[data-source="large-gas-turbine"]')).toBeNull();
    act(() => setLocale("en"));
    expect(screen.getByRole("combobox", { name: "Power type" })).toBe(types);
    expect((types as HTMLSelectElement).value).toBe("burners");
    expect(document.querySelector('[data-source="gas-turbine"]')?.textContent).toContain("Gas Turbine");
  });

  it("translates a fuel match while placing the canonical fuel value", () => {
    render(<PowerSourceOverlay />);
    fireEvent.change(screen.getByPlaceholderText(translateMessage("Machine, fuel, or product...", "zh-CN")), {
      target: { value: "benfen" },
    });
    const source = document.querySelector('[data-source="universal-chemical-fuel-engine"]')!;
    expect(source.textContent).toContain("苯酚");
    expect(source.textContent).not.toMatch(/Takes|Makes|Phenol/);
    fireEvent.click(source);
    expect(add).toHaveBeenCalledWith("universal-chemical-fuel-engine", expect.objectContaining({ fuel: "Phenol" }));
  });
});
