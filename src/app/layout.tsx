import type { Metadata } from "next";
import "./globals.css";
import { SessionRefresh } from "./session-refresh";
import { PwaRegistration } from "./pwa-registration";

export const metadata: Metadata = {
  title: "School ERP",
  description: "School administration, attendance and family updates",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "School ERP", statusBarStyle: "default" },
  icons: { apple: "/icons/icon-180.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col"><SessionRefresh /><PwaRegistration />{children}</body>
    </html>
  );
}
