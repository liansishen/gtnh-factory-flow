"use client";

import { LOCALES, localeLabel, setLocale, type Locale } from "@/lib/i18n/locale";
import { useLocale } from "@/lib/i18n/react";

/**
 * The planner's language, a personal device setting. A native select: the
 * browser's own list, keyboard and screen-reader behaviour, no custom
 * dropdown.
 *
 * The label is bilingual on purpose: a player who cannot read the current
 * language still has to be able to find this control.
 */
export function LanguageSelect() {
  const locale = useLocale();
  return (
    <div className="ms-row" data-kind="choice">
      <span className="ms-text">
        <span className="ms-name">
          <span className="ms-label">Language / 语言</span>
        </span>
      </span>
      <span className="ms-spacer" />
      <span className="ms-choices">
        <select
          className="ms-select"
          aria-label="Language / 语言"
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
        >
          {LOCALES.map((id) => (
            <option key={id} value={id}>
              {localeLabel(id)}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
