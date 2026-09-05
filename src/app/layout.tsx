import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Recipes",
  description: "Recipes — pet project / work in progress",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
