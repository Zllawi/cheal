import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FuelMap Libya",
  description: "Fuel availability and congestion tracking for Libya",
  icons: {
    icon: "/icon.svg"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
