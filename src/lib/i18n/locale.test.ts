// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  applyDocumentLang,
  getLocale,
  getServerLocale,
  isLocale,
  localeLabel,
  setLocale,
  subscribeLocale,
} from "./locale";

beforeEach(() => {
  window.localStorage.clear();
  setLocale("en");
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the language preference", () => {
  it("is English with nothing stored", () => {
    expect(getLocale()).toBe("en");
    expect(DEFAULT_LOCALE).toBe("en");
    expect(getServerLocale()).toBe("en");
  });

  it("persists Chinese and reads it back", () => {
    setLocale("zh-CN");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(getLocale()).toBe("zh-CN");
  });

  it("carries no stored entry for the default, so a reset is a fresh profile", () => {
    setLocale("zh-CN");
    setLocale("en");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(getLocale()).toBe("en");
  });

  it("falls back to English when the stored value is not a locale", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    expect(getLocale()).toBe("en");
  });

  it("survives storage that refuses to write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setLocale("zh-CN")).not.toThrow();
    expect(getLocale()).toBe("zh-CN");
  });
});

describe("subscribers", () => {
  it("are told when the language changes, and stop when unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocale(listener);
    setLocale("zh-CN");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setLocale("en");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("follow a change written in another tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocale(listener);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    window.dispatchEvent(new StorageEvent("storage", { key: LOCALE_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLocale()).toBe("zh-CN");
    unsubscribe();
  });
});

describe("the document language", () => {
  it("is written on <html> and back", () => {
    applyDocumentLang("zh-CN");
    expect(document.documentElement.getAttribute("lang")).toBe("zh-CN");
    applyDocumentLang("en");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });
});

describe("the locale vocabulary", () => {
  it("accepts exactly the two locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("zh")).toBe(false);
    expect(isLocale("fr")).toBe(false);
  });

  it("names each option in its own language", () => {
    expect(localeLabel("en")).toBe("English");
    expect(localeLabel("zh-CN")).toBe("简体中文");
  });
});
