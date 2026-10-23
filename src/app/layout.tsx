import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pickleball København", template: "%s — Pickleball København" },
  description: "Book træninger, der passer til din DUPR-rating.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#1f5c4a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
