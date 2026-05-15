"use client";

import { useEffect, useRef, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { useLocaleStore } from '@/stores/locale-store';

type Messages = Record<string, unknown>;

// Static imports of every locale's catalog used to live here. They added
// ~2MB to the entry chunk for every visitor regardless of which locale
// they actually needed — most never even switch. The fix has two parts:
//
//  1) Template-literal dynamic import: `import(\`@/locales/${locale}/...\`)`.
//     Tells the bundler "match these paths at build time, emit one chunk
//     per match, choose at runtime." Each locale becomes its own ~140KB
//     async chunk instead of all 16 living in the entry bundle.
//
//  2) Module-scope Map cache: once a user has paid the network cost of
//     fetching a locale, switching back to it is free. The SSR-provided
//     initial-locale catalog is seeded into the cache on first mount so
//     that initial render has zero async hop.
const messagesCache = new Map<string, Messages>();

async function loadLocaleMessages(locale: string): Promise<Messages> {
  const cached = messagesCache.get(locale);
  if (cached) return cached;

  let messages: Messages;
  try {
    messages = (await import(`@/locales/${locale}/common.json`)).default;
  } catch {
    // Unknown / bad locale — fall back to English. English is always
    // already cached after first mount (it's typically the SSR default),
    // so this branch only allocates on the rare cold path.
    messages = (await import(`@/locales/en/common.json`)).default;
  }
  messagesCache.set(locale, messages);
  return messages;
}

interface IntlProviderProps {
  locale: string;
  messages: Messages;
  children: React.ReactNode;
}

export function IntlProvider({
  locale: initialLocale,
  messages: initialMessages,
  children,
}: IntlProviderProps) {
  const currentLocale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const [activeLocale, setActiveLocale] = useState(currentLocale || initialLocale);
  const [messages, setMessages] = useState<Messages>(initialMessages);
  const [timeZone, setTimeZone] = useState<string>('UTC');

  // Seed cache with SSR-provided messages so a round-trip back to the
  // initial locale doesn't pay an async hop. Done in render (not in
  // useEffect) so the cache is hot before any locale-switch effect runs.
  const seededRef = useRef(false);
  if (!seededRef.current) {
    messagesCache.set(initialLocale, initialMessages);
    seededRef.current = true;
  }

  useEffect(() => {
    try {
      setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch (error) {
      console.warn('Failed to detect timezone, using UTC:', error);
      setTimeZone('UTC');
    }
  }, []);

  useEffect(() => {
    if (!currentLocale) {
      setLocale(initialLocale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!currentLocale || currentLocale === activeLocale) return;
    // Lazy-load the new locale. Current messages stay visible during the
    // fetch — no flash of untranslated strings. Cancel-on-unmount in case
    // the user switches twice fast.
    let canceled = false;
    void (async () => {
      const msgs = await loadLocaleMessages(currentLocale);
      if (canceled) return;
      setMessages(msgs);
      setActiveLocale(currentLocale);
    })();
    return () => {
      canceled = true;
    };
  }, [currentLocale, activeLocale]);

  return (
    <NextIntlClientProvider
      locale={activeLocale}
      messages={messages}
      timeZone={timeZone}
    >
      {children}
    </NextIntlClientProvider>
  );
}
