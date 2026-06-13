import type { Metadata, Viewport } from "next";
import { Fraunces, Albert_Sans } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["opsz"],
});
const albert = Albert_Sans({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "SundayStage — vis sanger over nettverk",
  description:
    "Del sangtekster og kunngjøringer live til prosjektor, TV og mobiler — lavlatens visning over nettverk for menigheten.",
};

export const viewport: Viewport = {
  themeColor: "#08070b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no" className={`${fraunces.variable} ${albert.variable}`}>
      <body>{children}</body>
    </html>
  );
}
