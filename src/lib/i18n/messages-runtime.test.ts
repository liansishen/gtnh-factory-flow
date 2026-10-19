import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { translateMessage } from "./messages";

const catalog = JSON.parse(
  fs.readFileSync(new URL("./messages-runtime-zh.json", import.meta.url), "utf8"),
) as Record<string, string>;

describe("the runtime message catalog", () => {
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

  it("answers the Full history count through the runtime rule", () => {
    expect(translateMessage("Full history (206 earlier releases)", "zh-CN")).toBe(
      "完整历史（更早的 206 个版本）",
    );
    expect(translateMessage("Full history (1 earlier release)", "zh-CN")).toBe(
      "完整历史（更早的 1 个版本）",
    );
  });

  it("matches complete tooltip sentences before recipe-count rules", () => {
    expect(translateMessage("Items: search and place recipes", "zh-CN")).toBe("物品：搜索物品并放置配方");
    expect(translateMessage("Items: search and place recipes", "en")).toBe("Items: search and place recipes");
    expect(translateMessage("1,234 recipes", "zh-CN")).toBe("1,234 个配方");
    expect(translateMessage("1 recipe", "zh-CN")).toBe("1 个配方");
    expect(translateMessage("3 recipes and more", "zh-CN")).toBe("3 recipes and more");
  });
});
