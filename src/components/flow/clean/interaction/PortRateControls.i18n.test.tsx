// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { setLocale } from "@/lib/i18n/locale";
import type { CleanPortView } from "../clean-model";
import { PortRateControls } from "./PortRateControls";

afterEach(() => {
  cleanup();
  setLocale("en");
});

/** An unwired, unpinned input port: the card's rate box shows its "Set" prompt. */
function openPort(): CleanPortView {
  return {
    key: "input:1",
    nodeId: "n1",
    handleId: "input:item:mock:in",
    side: "input",
    port: {
      side: "input",
      kind: "item",
      key: "input:1",
      resourceId: "mock:in",
      displayName: "Resource input",
      handleId: "input:item:mock:in",
      connected: false,
      currentPerSecond: 1.5,
    },
    number: "900",
    unit: "/hr",
    name: "Resource input",
    title: "Resource input",
    zero: false,
    gold: false,
    numberSmall: false,
    nameSmall: false,
    nameClipped: false,
    wired: false,
    choice: false,
    resourceKey: "item:mock:in",
  } as unknown as CleanPortView;
}

it("renders an open port's rate box prompt through the dictionary", () => {
  render(<PortRateControls p={openPort()} unset wasClick={() => true} />);
  expect(screen.getByText("Set")).toBeTruthy();

  act(() => setLocale("zh-CN"));
  expect(screen.getByText("设置")).toBeTruthy();
  expect(screen.queryByText("Set")).toBeNull();
});
