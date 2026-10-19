import { describe, expect, it } from "vitest";
import { buildTextSearchIndex, queryTextSearchIndex, matchSearchEntry, parseSearchQuery, splitSearchTokens } from "@/lib/search";
import { buildPinyinSearchIndex, matchesPinyinNameFilter, withPinyinSearch } from "./pinyin-search";

const names = ["Steel Plate", "Steel Ingot", "Stainless Steel Plate", "Aluminium Plate", "Vanadium", "Fan", "Water"];
const index = buildPinyinSearchIndex(names);
const answers = (query: string) => index.search(query).map(hit => hit.name);
const fields = (name: string) => ({ nameText: name.toLowerCase(), name: splitSearchTokens(name) });

describe("indexed pinyin aliases", () => {
  it.each(["gangban", "gang ban", "gb", "gangb", "gban", "钢ban", "gang板", "ＧＡＮＧＢＡＮ"])("finds Steel Plate for %s", query => {
    expect(answers(query)).toContain("Steel Plate");
    expect(answers(query)[0]).toBe("Steel Plate");
    expect(answers(query)).not.toContain("Steel Ingot");
  });
  it("distinguishes full-name matches from substrings and preserves homophones", () => {
    expect(answers("gangban")).toContain("Stainless Steel Plate");
    const homophones = buildPinyinSearchIndex(["汉化", "喊话"]);
    expect(homophones.search("hh").map(hit => hit.name)).toEqual(["喊话", "汉化"]);
  });
  it("supports interleaved syllables, initials and literal Chinese", () => {
    const mixed = buildPinyinSearchIndex(["夜视药水"]);
    for (const query of ["yeshiyaoshui", "ysys", "yshiysh", "夜shi药shui"]) expect(mixed.search(query)).toHaveLength(1);
  });
  it("includes polyphonic readings and GTNH element aliases", () => {
    const elements = buildPinyinSearchIndex(["重油", "𬬻锭", "\ue900锭"]);
    expect(elements.search("zhongyou").map(hit => hit.name)).toContain("重油");
    expect(elements.search("chongyou").map(hit => hit.name)).toContain("重油");
    expect(elements.search("jinluding").map(hit => hit.name)).toContain("𬬻锭");
    expect(elements.search("luding").map(hit => hit.name)).toContain("\ue900锭");
  });
  it("keeps technical tokens and malformed/empty queries out of pinyin expansion", () => {
    for (const query of ["", "g", "lv", "LV", "HV", "eu", "gt", "ebf", "512 EU/t", "gregtech:gt.metaitem.01@17305", "zzzzzqpyn"]) expect(answers(query)).toEqual([]);
    expect(answers("lvban")).toContain("Aluminium Plate");
  });
  it("reuses a bounded query cache without truncating the answer set", () => {
    const before = index.search("gangban");
    expect(index.search("gangban")).toBe(before);
    for (let n = 0; n < 100; n++) index.search(`missing${n}`);
    expect(index.search("gangban")).toEqual(before);
  });
});

describe("pinyin variants in the shipped English matcher", () => {
  const query = (text: string) => withPinyinSearch(parseSearchQuery(text), () => index);
  it.each(["gangban", "gang ban", "gb", "gangb", "gban"])("matches through English token indexes for %s", text => {
    expect(matchSearchEntry(query(text), fields("Steel Plate"))).toBeGreaterThan(0);
    expect(matchSearchEntry(query(text), fields("Steel Ingot"))).toBeUndefined();
  });
  it("ranks a full Chinese name above one containing it", () => {
    const parsed = query("gangban");
    expect(matchSearchEntry(parsed, fields("Steel Plate"))).toBeGreaterThan(matchSearchEntry(parsed, fields("Stainless Steel Plate"))!);
  });
  it("ranks a phonetic name even when Chinese planning supplied no English tokens", () => {
    const phenols = buildPinyinSearchIndex(["Phenol", "Phenol Sample"]);
    const parsed = withPinyinSearch(parseSearchQuery(""), () => phenols, "ben酚");
    expect(matchSearchEntry(parsed, fields("Phenol"))).toBeGreaterThan(matchSearchEntry(parsed, fields("Phenol Sample"))!);
  });
  it("keeps literal English prefixes ahead of phonetic names", () => {
    const names = ["Gangue Dust", "Steel Ingot", "Steel Plate", "Banded Iron Dust", "Wrench", "Dandelion Yellow", "Nitrogen"];
    const index = buildPinyinSearchIndex(names);
    for (const [raw, literal, phonetic] of [["gang", "Gangue Dust", "Steel Ingot"], ["ban", "Banded Iron Dust", "Wrench"], ["dan", "Dandelion Yellow", "Nitrogen"]]) {
      const parsed = withPinyinSearch(parseSearchQuery(raw), () => index);
      expect(matchSearchEntry(parsed, fields(literal))).toBeGreaterThan(matchSearchEntry(parsed, fields(phonetic)) ?? 0);
    }
  });
  it("keeps English exact matches above phonetic aliases", () => {
    const parsed = query("fan");
    expect(parsed).toEqual(parseSearchQuery("fan"));
    expect(matchSearchEntry(parsed, fields("Fan"))).toBeGreaterThan(matchSearchEntry(parsed, fields("Vanadium")) ?? 0);
  });
  it("keeps all mixed-query conditions and never changes the input", () => {
    const parsed = parseSearchQuery("gt gangban");
    const before = JSON.stringify(parsed);
    const enriched = withPinyinSearch(parsed, () => index);
    expect(matchSearchEntry(enriched, { ...fields("Steel Plate"), id: ["gregtech"] })).toBeGreaterThan(0);
    expect(matchSearchEntry(enriched, { ...fields("Steel Plate"), id: ["minecraft"] })).toBeUndefined();
    expect(JSON.stringify(parsed)).toBe(before);
  });
  it("keeps voltage and unit queries byte-identical", () => {
    for (const text of ["LV", "HV", "512 EU/t", "ebf", "gregtech:gt.metaitem.01@17305"]) {
      const parsed = parseSearchQuery(text);
      expect(withPinyinSearch(parsed, () => index)).toEqual(parsed);
    }
  });
  it("does not turn unknown letters into an empty browse query", () => {
    const parsed = query("zzzzzqpyn");
    expect(parsed.terms).toHaveLength(1);
    expect(matchSearchEntry(parsed, fields("Steel Plate"))).toBeUndefined();
  });
});

describe("pinyin in local game-name filters", () => {
  it.each(["gangban", "gang ban", "gb", "gangb", "钢ban", "gang板"])("matches %s against the Chinese display alias", text => {
    expect(matchesPinyinNameFilter(text, "Steel Plate")).toBe(true);
    expect(matchesPinyinNameFilter(text, "Steel Ingot")).toBe(false);
  });
  it("keeps English modifiers and protects voltage abbreviations", () => {
    expect(matchesPinyinNameFilter("stainless gangban", "Stainless Steel Plate")).toBe(true);
    expect(matchesPinyinNameFilter("stainless gangban", "Steel Plate")).toBe(false);
    expect(matchesPinyinNameFilter("lv", "Aluminium Plate")).toBe(false);
    expect(matchesPinyinNameFilter("lvban", "Aluminium Plate")).toBe(true);
    expect(matchesPinyinNameFilter("zzzzzqpyn", "Steel Plate")).toBe(false);
  });
});

describe("pinyin of existing Chinese search aliases", () => {
  it("accepts both Chinese names already used for Bending Machine", () => {
    const index = buildPinyinSearchIndex(["Bending Machine"]);
    for (const query of ["wanquji", "juanbanji", "wqj", "jbj"]) {
      expect(index.search(query).map(hit => hit.name), query).toContain("Bending Machine");
      expect(matchesPinyinNameFilter(query, "Bending Machine"), query).toBe(true);
    }
  });
});

describe("pinyin candidate narrowing", () => {
  it("keeps short English hits and phonetic initials in the same result set", () => {
    const corpus = [...names, "1 GB Memory", "Block of Coal"];
    const phonetic = buildPinyinSearchIndex(corpus);
    const text = buildTextSearchIndex(corpus, corpus.map((_, n) => n));
    for (const raw of ["gb", "gangban", "gangb", "gang ban"]) {
      const parsed = withPinyinSearch(parseSearchQuery(raw), () => phonetic, raw);
      const narrowed = queryTextSearchIndex(text, parsed);
      expect(narrowed, raw).toBeDefined();
      const expected = corpus.map((name, n) => matchSearchEntry(parsed, fields(name)) !== undefined ? n : -1).filter(n => n >= 0);
      const actual = (narrowed ?? []).filter(n => matchSearchEntry(parsed, fields(corpus[n])) !== undefined);
      expect(actual, raw).toEqual(expected);
      expect(actual.map(n => corpus[n]), raw).toContain("Steel Plate");
      if (raw === "gb") expect(actual.map(n => corpus[n])).toContain("1 GB Memory");
    }
  });
});
