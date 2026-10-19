import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { translateMessage } from "./messages";

const catalog = JSON.parse(
  fs.readFileSync(new URL("./messages-menus-zh.json", import.meta.url), "utf8"),
) as Record<string, string>;

describe("the menus message catalog", () => {
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
      expect(translateMessage(key, "en"), key).toBe(key);
    }
  });

  it("answers the tab, + and Share menus' rows", () => {
    expect(translateMessage("Paste plan", "zh-CN")).toBe("粘贴方案");
    expect(translateMessage("a plan link, code or file", "zh-CN")).toBe("方案链接、代码或文件");
    expect(translateMessage("Delete plan", "zh-CN")).toBe("删除方案");
    expect(translateMessage("Copy plan link", "zh-CN")).toBe("复制方案链接");
    expect(translateMessage("Post a copy to Community...", "zh-CN")).toBe("向社区发布副本…");
    expect(translateMessage("Update in Community...", "zh-CN")).toBe("在社区更新…");
    expect(translateMessage("Paste plan", "en")).toBe("Paste plan");
  });

  it("answers the sharing notices and the live state's words", () => {
    expect(translateMessage("Copied the plan link.", "zh-CN")).toBe("已复制方案链接。");
    expect(translateMessage("Couldn't copy the plan code.", "zh-CN")).toBe("无法复制方案代码。");
    expect(translateMessage("Open in the game", "zh-CN")).toBe("在游戏中打开");
    expect(
      translateMessage(
        "Offline: your edits are kept here and go when the connection is back",
        "zh-CN",
      ),
    ).toBe("离线：你的编辑保存在本地，恢复连接后会自动发送");
  });
});
