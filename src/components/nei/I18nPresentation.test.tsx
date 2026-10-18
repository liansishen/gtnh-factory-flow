// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { McTipLines, itemTipLines } from "./McTip";
import { TipPanel } from "@/components/flow/clean/interaction/TipPanel";

beforeEach(() => { setLocale("en"); });
afterEach(() => { cleanup(); setLocale("en"); });

describe("native planner presentation", () => {
  it("localizes the resource tooltip while retaining its canonical source and original mod name", () => {
    const resource = { id: "gregtech:gt.metaitem.01@17305", name: "Steel Plate", extra: ["3 recipes"] };
    const before = JSON.stringify(resource);
    render(<McTipLines lines={itemTipLines(resource)} />);
    expect(screen.getByText("Steel Plate")).toBeTruthy();
    act(() => setLocale("zh-CN"));
    expect(screen.getByText("钢板")).toBeTruthy();
    expect(screen.getByText("3 个配方")).toBeTruthy();
    expect(screen.getByText("GregTech")).toBeTruthy();
    expect(JSON.stringify(resource)).toBe(before);
    act(() => setLocale("en"));
    expect(screen.getByText("Steel Plate")).toBeTruthy();
    expect(screen.queryByText("钢板")).toBeNull();
  });

  it("keeps a user-authored group title verbatim while translating its controls", () => {
    const spec = { id: "group-a|strip", title: "Steel Plate", verbatimTitle: true, actions: [{ input: "left" as const, label: "Expand" }] };
    render(<TipPanel spec={spec} />);
    act(() => setLocale("zh-CN"));
    expect(screen.getByText("Steel Plate")).toBeTruthy();
    expect(screen.queryByText("钢板")).toBeNull();
    expect(screen.getByText("展开")).toBeTruthy();
    expect(spec.title).toBe("Steel Plate");
  });
});
