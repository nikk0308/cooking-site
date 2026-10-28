import { notFound } from "next/navigation";
import { uuid } from "@/modules/recipes/reference";
import { PersonalRecipeEditor } from "@/components/personal-editor";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = uuid.safeParse((await params).id);
  if (!id.success) notFound();
  return (
    <main>
      <PersonalRecipeEditor id={id.data} />
    </main>
  );
}
