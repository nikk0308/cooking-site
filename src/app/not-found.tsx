import Link from "next/link";
export default function NotFound() {
  return (
    <main>
      <h1>Рецепт не найден</h1>
      <p>Страница недоступна или ещё не опубликована.</p>
      <Link href="/">Все рецепты</Link>
    </main>
  );
}
