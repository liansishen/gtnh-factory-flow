import type { Locale } from "./locale";
import messagesZh from "./messages-zh.json";
import secondaryZh from "./messages-secondary-zh.json";
import plannerZh from "./messages-planner-zh.json";
import inventoryZh from "./messages-inventory-zh.json";
import runtimeZh from "./messages-runtime-zh.json";
import rulesZh from "./rules-zh.json";
import plannerRules from "./rules-planner-zh.json";
import runtimeRules from "./rules-runtime-zh.json";

// English-source messages keep upstream copy readable and provide the fallback.
export function normalizeMessageKey(source: string): string {
  return source.trim().replace(/\s+/g, " ");
}

const exact = new Map(Object.entries({ ...messagesZh, ...secondaryZh, ...plannerZh, ...inventoryZh, ...runtimeZh })
  .map(([key, value]) => [normalizeMessageKey(key), value.trim()]));

export function hasMessageTranslation(source: string): boolean {
  return exact.has(normalizeMessageKey(source));
}
const cache = new Map<string, string>();
let compiled: Array<{ re: RegExp; zh: string }> | undefined;

function rules() {
  return compiled ??= [...runtimeRules, ...plannerRules, ...rulesZh].map(rule => ({ re: new RegExp(rule.re, rule.flags), zh: rule.zh }));
}

export function translateMessage(source: string, locale: Locale): string {
  if (locale === "en" || !/[A-Za-z]/.test(source)) return source;
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  const normalized = normalizeMessageKey(source);
  let translated = exact.get(normalized);
  if (translated === undefined) {
    for (const rule of rules()) {
      rule.re.lastIndex = 0;
      const match = rule.re.exec(normalized);
      if (match) {
        translated = rule.zh.replace(/\$(\d+)/g, (_, group: string) => match[Number(group)] ?? "");
        break;
      }
    }
  }
  const value = translated === undefined ? source : (source.match(/^\s*/)?.[0] ?? "") + translated + (source.match(/\s*$/)?.[0] ?? "");
  if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
  cache.set(source, value);
  return value;
}
