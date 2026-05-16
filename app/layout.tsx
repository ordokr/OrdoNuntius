import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { configManager } from "@/lib/admin/config-manager";
import {
  getBootstrapPayload,
  serializeForScriptTag,
  BOOTSTRAP_SCRIPT_ID,
} from "@/lib/admin/bootstrap-payload";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Newsreader powers the "scholarly inkwell" display type. Current use is
// limited to two H1s on the login splash — both `font-serif italic
// font-medium`, i.e. italic weight 500 only. Loading the full 3-weights ×
// 2-styles = 6-file set put ~150 KB of unused font on the first-paint
// critical path. If a future surface needs a different weight or upright
// style, add it explicitly here.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["500"],
  style: ["italic"],
});

export async function generateMetadata(): Promise<Metadata> {
  await configManager.ensureLoaded();
  const faviconUrl = configManager.get<string>("faviconUrl", "/branding/OrdoNuntius_Favicon.svg");

  return {
    title: process.env.APP_NAME || process.env.NEXT_PUBLIC_APP_NAME || "Webmail",
    description: "Minimalist webmail client using JMAP protocol",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: process.env.APP_NAME || process.env.NEXT_PUBLIC_APP_NAME || "Webmail",
    },
    formatDetection: {
      telephone: false,
    },
    icons: { icon: faviconUrl },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const nonce = (await headers()).get("x-nonce") ?? "";
  const parentOrigin = process.env.NEXT_PUBLIC_PARENT_ORIGIN || "";
  // Bootstrap payload inlined into the SSR HTML so the client doesn't
  // need a /api/config or /api/admin/policy fetch on cold load. Both
  // were 30-50ms RTTs that sat on the critical path before any meaningful
  // UI work could start. The payload is small (~1-2 KB serialized).
  const bootstrapJson = serializeForScriptTag(await getBootstrapPayload());

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#FAF8F3" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-title"
          content={process.env.APP_NAME || process.env.NEXT_PUBLIC_APP_NAME || "Webmail"}
        />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {parentOrigin && (
          <meta name="parent-origin" content={parentOrigin} />
        )}
        <script
          id={BOOTSTRAP_SCRIPT_ID}
          type="application/json"
          dangerouslySetInnerHTML={{ __html: bootstrapJson }}
        />
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const stored = localStorage.getItem('theme-storage');
                  const theme = stored ? JSON.parse(stored).state.theme : 'system';
                  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  const resolved = theme === 'system' ? systemTheme : theme;
                  document.documentElement.classList.remove('light', 'dark');
                  document.documentElement.classList.add(resolved);
                } catch (e) {
                  document.documentElement.classList.add('light');
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} antialiased`}
      >
        <ServiceWorkerRegistration />
        {children}
        <PWAInstallPrompt />
      </body>
    </html>
  );
}
