import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { PWAProvider } from "@/components/providers/PWAProvider";
import { PWAEnhanced } from "@/components/providers/PWAEnhanced";
import { NativeProvider } from "@/components/providers/NativeProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { Toaster } from "sonner";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { auth } from "@/lib/auth";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s | École Miriam",
    default: "École Miriam — Gestion scolaire moderne",
  },
  description:
    "Plateforme SaaS multi-tenant pour la gestion d'établissements scolaires. Élèves, absences, notes, examens, parents — tout en un.",
  keywords: ["école", "gestion scolaire", "SaaS", "Afrique", "notes", "absences"],
  authors: [{ name: "École Miriam" }],
  creator: "École Miriam",
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    title: "École Miriam — Gestion scolaire moderne",
    description: "La plateforme scolaire de nouvelle génération pour l'Afrique",
    siteName: "École Miriam",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const session = await auth();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#6366f1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="École Miriam" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            <AuthProvider session={session}>
              <PWAProvider />
              <PWAEnhanced />
              <NativeProvider />
              {children}
              <Toaster position="top-right" richColors closeButton />
            </AuthProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
