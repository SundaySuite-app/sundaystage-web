import type { Metadata, Viewport } from "next";
import { Playfair_Display, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "./sw-register";
import { LangSync } from "./lang-sync";

// Sunday Suite brand fonts — Playfair Display (display/wordmark) + Hanken
// Grotesk (body), shared across the suite.
const display = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
});
const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SundayStage — vis sanger over nettverk",
  description:
    "Del sangtekster og kunngjøringer live til prosjektor, TV og mobiler — lavlatens visning over nettverk for menigheten.",
  applicationName: "SundayStage",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "SundayStage",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#08070b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no" className={`${display.variable} ${body.variable}`}>
      <body>
        <ServiceWorkerRegister />
        <LangSync />
        {children}
      </body>
    </html>
  );
}
