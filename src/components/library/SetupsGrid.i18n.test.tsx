// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { SetupsGrid } from "./SetupsGrid";

afterEach(() => { cleanup(); setLocale("en"); vi.unstubAllGlobals(); });

it("localizes a real API-client error in the community shelf and updates it on locale changes", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "Community hub is not configured." }), { status: 503, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  render(<SetupsGrid scope="network" bare />);
  expect(await screen.findByText("Community hub is not configured.")).toBeTruthy();
  expect(fetch.mock.calls.length).toBeGreaterThan(0);
  act(() => setLocale("zh-CN"));
  expect(screen.getByText("社区功能尚未配置。")).toBeTruthy();
  expect(screen.queryByText("Community hub is not configured.")).toBeNull();
  act(() => setLocale("en"));
  expect(screen.getByText("Community hub is not configured.")).toBeTruthy();
});
