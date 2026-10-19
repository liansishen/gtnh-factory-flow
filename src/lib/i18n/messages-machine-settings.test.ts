import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { translateMessage } from "./messages";

const catalog = JSON.parse(
  fs.readFileSync(new URL("./messages-machine-settings-zh.json", import.meta.url), "utf8"),
) as Record<string, string>;

describe("the machine settings message catalog", () => {
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

  it("answers the settings sheet's copy, not a game name", () => {
    expect(translateMessage("No settings for this machine.", "zh-CN")).toBe("此机器没有可设置项。");
    expect(translateMessage("Set to", "zh-CN")).toBe("设为");
    expect(translateMessage("Recipe needs", "zh-CN")).toBe("配方需求");
    expect(translateMessage("none", "zh-CN")).toBe("无");
    expect(translateMessage("No settings for this machine.", "en")).toBe("No settings for this machine.");
  });

  it("answers the accessibility fragments and formula words", () => {
    expect(translateMessage("Pin", "zh-CN")).toBe("固定");
    expect(translateMessage("Unpin", "zh-CN")).toBe("取消固定");
    expect(translateMessage("to the card", "zh-CN")).toBe("到卡片");
    expect(translateMessage("from the card", "zh-CN")).toBe("从卡片");
    expect(translateMessage("Filter options", "zh-CN")).toBe("筛选选项");
    expect(translateMessage("Filter", "zh-CN")).toBe("过滤器");
    expect(translateMessage("K over", "zh-CN")).toBe("K 超出");
    expect(translateMessage("power", "zh-CN")).toBe("功率");
    expect(translateMessage("Pin", "en")).toBe("Pin");
  });
});
