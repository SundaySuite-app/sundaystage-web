import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SundayStage — vis sanger over nettverk",
  description:
    "Del sangtekster og kunngjøringer live til prosjektor, TV og mobiler — lavlatens visning over nettverk for menigheten.",
};

export const viewport: Viewport = {
  themeColor: "#05070f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no">
      <body>{children}</body>
    </html>
  );
}
