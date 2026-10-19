import { describe, expect, it } from "vitest";
import { matchSearchEntry, type SearchEntryFields, type SearchQuery, type SearchTermVariant } from "./text-search";
import { buildTextSearchIndex, queryTextSearchIndex } from "./text-index";

const words = ["steel", "plate", "copper", "dust", "tin", "a", "e", "gear", "rod", "lv", "water", "𬬻"];
const variants: SearchTermVariant[] = Array.from({ length: 160 }, (_, n) => ({
  tokens: Array.from({ length: n % 3 + 1 }, (_, i) => words[(n * 7 + i * 5) % words.length]),
  weight: 0.5 + (n % 6) / 10,
}));
const query = (forms: SearchTermVariant[]): SearchQuery => ({
  text: "",
  corrections: [],
  terms: [{ raw: "phonetic", variants: forms, correctable: false }],
});

function reference(entry: SearchEntryFields) {
  return Math.max(0, ...variants.map(variant => matchSearchEntry(query([variant]), entry) ?? 0)) || undefined;
}

describe("broad search variants", () => {
  it("keeps the same scores as individual variants across fields and substring precisions", () => {
    const broad = query(variants);
    for (let n = 0; n < 120; n++) {
      const entry = {
        name: [words[n % words.length], `${words[(n + 2) % words.length]}s`, `hot${words[(n + 3) % words.length]}`],
        id: [words[(n + 5) % words.length]],
        text: [words[(n + 8) % words.length], `ore${words[(n + 11) % words.length]}`],
      };
      expect(matchSearchEntry(broad, entry), JSON.stringify(entry)).toBe(reference(entry));
    }
    expect(matchSearchEntry(broad, { name: ["missing"] })).toBe(reference({ name: ["missing"] }));
    expect(matchSearchEntry(broad, {})).toBeUndefined();
  });

  it("preserves AND terms and partial fallback", () => {
    const broad = query(variants);
    broad.terms.push({ raw: "required", variants: [{ tokens: ["required"], weight: 1 }], correctable: false });
    expect(matchSearchEntry(broad, { name: ["steel", "plate"] })).toBeUndefined();
    const score = reference({ name: ["steel", "plate"] })!;
    expect(matchSearchEntry(broad, { name: ["steel", "plate"] }, { partial: true })).toBe(score + 1);
    expect(matchSearchEntry(broad, { name: ["steel", "plate", "required"] })).toBe(score + 1);
  });

  it("keeps every match when rare trigrams narrow many aliases", () => {
    const corpus = ["steel plate", "steel rod", "copper plate", "dust"];
    const text = buildTextSearchIndex(corpus, [0, 1, 2, 3]);
    const broad = query([
      ...Array.from({ length: 40 }, (_, n) => ({ tokens: [`material${n}`], weight: 0.8 })),
      { tokens: ["steel", "plate"], weight: 0.9 },
    ]);
    broad.nameAliases = new Map([["steel plate", 0.9]]);
    const candidates = queryTextSearchIndex(text, broad)!;
    expect(candidates).toBeDefined();
    expect(candidates.filter(n => matchSearchEntry(broad, { name: text.tokensByEntry[n] }) !== undefined)).toEqual([0]);
  });

  it("leaves a very broad phonetic union to the compiled scorer", () => {
    const text = buildTextSearchIndex(["steel plate", "copper dust"], [0, 1]);
    const broad = query(Array.from({ length: 600 }, (_, n) => ({ tokens: [`material${n}`], weight: 0.8 })));
    broad.nameAliases = new Map([["steel plate", 0.8]]);
    expect(queryTextSearchIndex(text, broad)).toBeUndefined();
    expect(matchSearchEntry(broad, { name: ["steel", "plate"] })).toBeUndefined();
  });
});
