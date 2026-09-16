import Link from "next/link";
export function AdminNav() {
  return (
    <div className="actions">
      <Link href="/admin/recipes">Рецепты</Link>
      <Link href="/admin/ingredients">Ингредиенты</Link>
      <form action="/admin/logout" method="post">
        <button className="secondary">Выйти</button>
      </form>
    </div>
  );
}
