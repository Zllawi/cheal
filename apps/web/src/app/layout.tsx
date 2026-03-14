import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FuelMap Libya",
  description: "منصة ذكية لمتابعة توفر الوقود والازدحام في ليبيا"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
