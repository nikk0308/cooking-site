import { notFound } from "next/navigation";
import { uuid } from "@/modules/recipes/reference";
import { PersonalRecipeDetail } from "@/components/personal-recipes";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const id = uuid.safeParse((await params).id);
  if (!id.success) notFound();
  return (
    <main>
      {(await searchParams).saved === "1" && (
        <p role="status">Личный рецепт сохранён в этом браузере.</p>
      )}
      <PersonalRecipeDetail id={id.data} />
    </main>
  );
}
