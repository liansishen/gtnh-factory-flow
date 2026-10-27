// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vitest";
import { writeDeviceSettings } from "@/lib/device-settings";
import { TipPanel } from "./TipPanel";
import { setLocale } from "@/lib/i18n/locale";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  cleanup();
  act(() => writeDeviceSettings({ scrollChangesValues: true }));
  act(() => setLocale("en"));
});

const spec = {
  id: "t",
  title: "Count",
  actions: [
    { input: "left" as const, label: "Type a value" },
    { input: "wheel" as const, label: "Step" },
  ],
};
const actionLabels = (container: HTMLElement) =>
  [...container.querySelectorAll(".tp-action")].map((element) => element.textContent);

it("lists the wheel step while the wheel changes values, and drops it when it does not", () => {
  expect(actionLabels(render(<TipPanel spec={spec} />).container)).toEqual([
    "Type a value",
    "Step",
  ]);
  cleanup();
  act(() => writeDeviceSettings({ scrollChangesValues: false }));
  expect(actionLabels(render(<TipPanel spec={spec} />).container)).toEqual(["Type a value"]);
});

it("localizes consumption titles and values together while preserving their source", () => {
  const chanceSpec = {
    id: "consumed",
    title: "Leaves (used up 10% of runs)",
    rows: [{ label: "Used up", value: "10% of runs" }],
  };
  const before = JSON.stringify(chanceSpec);
  const { container } = render(<TipPanel spec={chanceSpec} />);
  expect(container.querySelector(".tp-title")?.textContent).toBe(chanceSpec.title);
  expect(container.querySelector(".tp-value")?.textContent).toBe("10% of runs");
  act(() => setLocale("zh-CN"));
  expect(container.querySelector(".tp-title")?.textContent).toBe("树叶（每次运行有 10% 的概率消耗）");
  expect(container.querySelector(".tp-label")?.textContent).toBe("消耗");
  expect(container.querySelector(".tp-value")?.textContent).toBe("每次运行有 10% 的概率");
  expect(JSON.stringify(chanceSpec)).toBe(before);
  act(() => setLocale("en"));
  expect(container.querySelector(".tp-title")?.textContent).toBe(chanceSpec.title);
  expect(container.querySelector(".tp-value")?.textContent).toBe("10% of runs");
});
