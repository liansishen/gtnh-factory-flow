"use client";

import { Fragment, useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { translateGameName } from "./game-names";
import {
  applyDocumentLang,
  getLocale,
  getServerLocale,
  subscribeLocale,
  type Locale,
} from "./locale";
import { translateMessage } from "./messages";

/**
 * The React side of the locale foundation.
 *
 * `useLocale` is the active language, `useT` a translate function bound to it
 * for attributes, placeholders and option arrays read at render, and
 * `I18nText` for text written in JSX. The English source string is the key: a
 * string with no entry and no rule falls through to itself, so the app reads
 * unchanged in English.
 *
 * The server always renders English, so hydration matches; `LocaleRestore`
 * puts the saved choice on `<html lang>` and keeps it there, and the store's
 * `useSyncExternalStore` repaints the tree in place rather than remounting it.
 */

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getServerLocale);
}

/** A translate function for this render's language, stable until it changes. */
export function useT(): (source: string) => string {
  const locale = useLocale();
  return useCallback((source: string) => translateMessage(source, locale), [locale]);
}

export interface I18nTextProps {
  children: ReactNode;
  /** A resource or machine label: the game's own name dictionary answers it. */
  game?: boolean;
}

/**
 * Translates the string children it is handed and renders them in place: a
 * fragment, never a wrapper element, so the text stays where the layout put
 * it. Non-string children (elements, numbers, null) pass through untouched.
 */
export function I18nText({ children, game = false }: I18nTextProps) {
  const locale = useLocale();
  if (locale === "en") {
    return <>{children}</>;
  }
  return <>{translateNode(children, locale, game)}</>;
}

function translateNode(node: ReactNode, locale: Locale, game: boolean): ReactNode {
  if (typeof node === "string") {
    const message = translateMessage(node, locale);
    return game && message === node ? translateGameName(node, locale) : message;
  }
  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <Fragment key={index}>{translateNode(child, locale, game)}</Fragment>
    ));
  }
  return node;
}

/**
 * Restores the saved language's `<html lang>` once the app runs, and after a
 * back-forward-cache restore, where no script runs. The server markup is
 * always `lang="en"`; this is where a Chinese device's lang attribute (and
 * the CJK font fallback globals.css keys on it) comes from.
 */
export function LocaleRestore() {
  useEffect(() => {
    const restore = () => applyDocumentLang(getLocale());
    restore();
    const unsubscribe = subscribeLocale(restore);
    window.addEventListener("pageshow", restore);
    return () => {
      unsubscribe();
      window.removeEventListener("pageshow", restore);
    };
  }, []);
  return null;
}

/** A localized label for a canonical resource or machine. */
export function useGameName(): (source: string) => string {
  const locale = useLocale();
  return useCallback((source: string) => {
    const message = translateMessage(source, locale);
    return message === source ? translateGameName(source, locale) : message;
  }, [locale]);
}
