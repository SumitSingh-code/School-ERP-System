import type { Metadata } from "next";
import "./globals.css";
import { SessionRefresh } from "./session-refresh";

export const metadata: Metadata = {
  title: "School ERP",
  description: "School administration, attendance and family updates",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col"><SessionRefresh />{children}</body>
    </html>
  );
}
