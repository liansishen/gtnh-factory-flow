/**
 * The interface language, as a setting.
 *
 * One preference, this browser's alone: kept in localStorage under
 * `gtnh-locale` and never written to a plan or the store, so switching
 * language cannot touch what a player has drawn. `en` is the default and
 * carries no stored entry, so a fresh profile and a reset one are the same
 * state.
 *
 * The server always renders English (the layout's `lang="en"` and every
 * string), so hydration is safe. `LocaleRestore` (react.tsx) puts the saved
 * choice on `<html lang>` once the app runs, and `subscribeLocale` feeds
 * `useSyncExternalStore` so the React tree repaints without remounting.
 */

export type Locale = "en" | "zh-CN";

export const DEFAULT_LOCALE: Locale = "en";

/** The choices the settings control offers, in order. */
export const LOCALES: readonly Locale[] = ["en", "zh-CN"];

/** Each choice's own name, so a player reads the option in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

/** Shared with the settings control and with tests. */
export const LOCALE_STORAGE_KEY = "gtnh-locale";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-CN";
}

export function localeLabel(locale: Locale): string {
  return LOCALE_LABELS[locale];
}

const listeners = new Set<() => void>();
let volatileLocale: Locale | undefined;

/**
 * The preference saved on this device, or the default. Reads storage on every
 * call rather than caching: the value is one of two strings, so the snapshot
 * `useSyncExternalStore` compares is stable by value, and a change made in
 * another tab reaches this one through the `storage` event below.
 */
export function getLocale(): Locale {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }
  if (volatileLocale !== undefined) return volatileLocale;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** What the server renders: always English, so hydration never mismatches. */
export function getServerLocale(): Locale {
  return DEFAULT_LOCALE;
}

/**
 * Puts the language on `<html lang>`; the CJK font fallback in globals.css
 * keys on it. A no-op on the server, where nothing is mounted yet.
 */
export function applyDocumentLang(locale: Locale): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (root.getAttribute("lang") !== locale) {
    root.setAttribute("lang", locale);
  }
}

/**
 * Remembers the language for this browser and tells every subscriber. Touches
 * localStorage and nothing else: no plan, no store, no network.
 */
export function setLocale(locale: Locale): void {
  if (!isLocale(locale)) {
    return;
  }
  if (typeof window !== "undefined") {
    try {
      if (locale === DEFAULT_LOCALE) {
        window.localStorage.removeItem(LOCALE_STORAGE_KEY);
      } else {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      }
      volatileLocale = undefined;
    } catch {
      volatileLocale = locale;
    }
  }
  notify();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  ensureStorageListener();
  return () => {
    listeners.delete(listener);
  };
}

let storageBound = false;

function ensureStorageListener(): void {
  if (storageBound || typeof window === "undefined") {
    return;
  }
  storageBound = true;
  window.addEventListener("storage", onStorageChange);
}

/** Another tab wrote the preference; this tab follows it. */
function onStorageChange(event: StorageEvent): void {
  if (event.key !== null && event.key !== LOCALE_STORAGE_KEY) {
    return;
  }
  volatileLocale = undefined;
  notify();
}

function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}
