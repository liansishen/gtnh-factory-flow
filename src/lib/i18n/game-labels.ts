import type { Locale } from "./locale";
import { hasChinese, translateGameName } from "./game-names";
import { hasMessageTranslation, translateMessage } from "./messages";

/** Punctuation-only UI rules must still allow a game-name lookup. */
export function translateGameLabel(source: string, locale: Locale): string {
  const message = translateMessage(source, locale);
  if (message !== source && (hasMessageTranslation(source) || hasChinese(message))) {
    return message;
  }
  const name = translateGameName(source, locale);
  return name === source ? message : name;
}
