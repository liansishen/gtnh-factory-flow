import type { Locale } from "./locale";
import { hasChinese, translateGameName } from "./game-names";
import { hasMessageTranslation, translateMessage } from "./messages";

/** Punctuation-only UI rules must still allow a game-name lookup. */
export function translateGameLabel(source: string, locale: Locale): string {
  const consumed = /^(.*) \(used up ([\d,.]+)% of runs\)$/.exec(source);
  if (locale === "zh-CN" && consumed) {
    const name = translateGameLabel(consumed[1], locale);
    const chance = translateMessage(`Used up ${consumed[2]}% of runs`, locale);
    return `${name}（${chance}）`;
  }
  const message = translateMessage(source, locale);
  if (message !== source && (hasMessageTranslation(source) || hasChinese(message))) {
    return message;
  }
  const name = translateGameName(source, locale);
  return name === source ? message : name;
}
