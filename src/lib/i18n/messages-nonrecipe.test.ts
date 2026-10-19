import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { POWER_GROUPS, POWER_SOURCES } from "@/lib/power/registry";
import { translateMessage } from "./messages";

const catalog = JSON.parse(
  fs.readFileSync(new URL("./messages-nonrecipe-zh.json", import.meta.url), "utf8"),
) as Record<string, string>;

describe("the non-recipe message catalog", () => {
  it("holds a non-empty Chinese value for every key", () => {
    const entries = Object.entries(catalog);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, value] of entries) {
      expect(typeof value, key).toBe("string");
      expect(value.trim(), key).not.toBe("");
      expect(/[\u4e00-\u9fff]/.test(value), key).toBe(true);
    }
  });

  it("is merged into the shipped translator", () => {
    for (const [key, value] of Object.entries(catalog)) {
      expect(translateMessage(key, "zh-CN"), key).toBe(value);
    }
  });

  it("leaves English exactly as the source wrote it", () => {
    for (const key of Object.keys(catalog)) {
      expect(translateMessage(key, "en"), key).toBe(key);
    }
  });

  it("answers every machine's description and every group's name", () => {
    for (const source of POWER_SOURCES) {
      expect(translateMessage(source.blurb, "zh-CN"), source.id).toMatch(/[\u4e00-\u9fff]/);
    }
    for (const group of POWER_GROUPS) {
      expect(translateMessage(group.name, "zh-CN"), group.id).toMatch(/[\u4e00-\u9fff]/);
    }
  });
});
