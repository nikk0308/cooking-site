import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = {
  title: "Recipes",
  description: "Рецепты, порции и список продуктов",
  ...(process.env.SITE_URL
    ? { metadataBase: new URL(process.env.SITE_URL) }
    : {}),
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <header>
          <Link className="brand" href="/">
            Recipes
          </Link>
          <nav aria-label="Основная навигация">
            <Link href="/">Рецепты</Link>
            <Link href="/basket">Список продуктов</Link>
            <Link href="/admin">Управление</Link>
          </nav>
        </header>
        {children}
        <footer>Recipes · Рецепты и список продуктов</footer>
      </body>
    </html>
  );
}
