// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { CHANGELOG } from "./changelog";
import { APP_VERSION, FORK_REVISION, UPSTREAM_VERSION } from "./version";
import { markNotesReadAndNotify, unseenEntries } from "./whats-new";

const NOTES_READ_KEY = "gtnh-factory-flow.changelog-read.v1";

beforeEach(() => window.localStorage.clear());

describe("fork releases", () => {
  it("appends the fork revision to the incorporated upstream version", () => {
    expect(UPSTREAM_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(FORK_REVISION).toBeGreaterThan(0);
    expect(APP_VERSION).toBe(`${UPSTREAM_VERSION}.${FORK_REVISION}`);
    expect(CHANGELOG[0].version).toBe(APP_VERSION);
  });

  it.each(["4.3.1", "4.3.2", "4.3.3", "4.3.0.3", "4.3.0.4", "4.3.0.5"])(
    "shows this release after the read stamp %s",
    (read) => {
      window.localStorage.setItem(NOTES_READ_KEY, read);
      expect(unseenEntries().map((entry) => entry.version)).toContain(APP_VERSION);
      markNotesReadAndNotify();
      expect(unseenEntries()).toEqual([]);
      expect(window.localStorage.getItem(NOTES_READ_KEY)).toBe(APP_VERSION);
    },
  );

  it.each([
    ["4.3.1", [APP_VERSION, "4.3.0.5", "4.3.0.4", "4.3.3", "4.3.2"]],
    ["4.3.0.1", [APP_VERSION, "4.3.0.5", "4.3.0.4", "4.3.3", "4.3.2"]],
    ["4.3.2", [APP_VERSION, "4.3.0.5", "4.3.0.4", "4.3.3"]],
    ["4.3.3", [APP_VERSION, "4.3.0.5", "4.3.0.4"]],
    ["4.3.0.4", [APP_VERSION, "4.3.0.5"]],
    ["4.3.0.5", [APP_VERSION]],
  ] as const)("preserves intermediate unread releases after %s", (read, expected) => {
    window.localStorage.setItem(NOTES_READ_KEY, read);
    expect(unseenEntries().map((entry) => entry.version)).toEqual(expected);
  });

  it("stamps a fresh device without opening release notes", () => {
    expect(unseenEntries()).toEqual([]);
    expect(window.localStorage.getItem(NOTES_READ_KEY)).toBe(APP_VERSION);
  });
});
