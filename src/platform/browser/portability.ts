import { z } from "zod";
import { browserExport } from "./export-contract";
import {
  type BrowserSnapshot,
  type StoredPhoto,
  type openBrowserRepository,
} from "./repository";
import { favoritesDocument } from "@/modules/favorites/document";
import { recipeKey } from "@/modules/recipes/reference";
import { validateImage, maxPhotoBytes } from "./images";

export const maxBackupBytes = 64 * 1024 * 1024;
const maxBinaryBytes = 40 * 1024 * 1024;
type Repo = Awaited<ReturnType<typeof openBrowserRepository>>;
export type PortableData = z.infer<typeof browserExport>;
export class PortabilityError extends Error {}
const fail = (message: string): never => {
  throw new PortabilityError(message);
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function mergePlan(
  target: BrowserSnapshot,
  incoming: PortableData,
  photos: StoredPhoto[],
  hashes: Map<string, string>,
) {
  const conflicts: string[] = [],
    recipes: PortableData["recipes"] = [],
    additions: StoredPhoto[] = [];
  let skipped = 0;
  for (const recipe of incoming.recipes) {
    const old = target.recipes.find(
      (r) => r.reference.id === recipe.reference.id,
    );
    if (!old) recipes.push(recipe);
    else if (same(old, recipe)) skipped++;
    else
      conflicts.push(
        `Рецепт «${recipe.title}»: ID уже занят другим содержимым.`,
      );
  }
  for (const p of photos) {
    const old = target.photos.find((o) => o.id === p.id);
    if (!old) additions.push(p);
    else if (
      old.recipeId !== p.recipeId ||
      old.blob.type !== p.blob.type ||
      hashes.get(`old:${p.id}`) !== hashes.get(`new:${p.id}`)
    )
      conflicts.push(`Фото ${p.id}: ID уже занят другим содержимым.`);
  }
  const empty = (s: BrowserSnapshot["shopping"]) =>
    !s.recipes.length && !s.manual.length && !s.overrides.length;
  let shopping = target.shopping;
  if (empty(target.shopping)) shopping = incoming.shopping;
  else if (
    !empty(incoming.shopping) &&
    !same(target.shopping, incoming.shopping)
  )
    conflicts.push(
      "Новый список покупок отличается. Сначала сохраните текущий backup и используйте отдельный профиль браузера для восстановления этого файла.",
    );
  const items = [...target.favorites.items];
  for (const ref of incoming.favorites.items)
    if (!items.some((r) => recipeKey(r) === recipeKey(ref))) items.push(ref);
  if (items.length > 500)
    conflicts.push("Объединённое избранное превысит лимит 500 ссылок.");
  const favorites =
    items.length > 500
      ? target.favorites
      : favoritesDocument.parse({ schemaVersion: 1, items });
  if (target.recipes.length + recipes.length > 500)
    conflicts.push("После импорта будет больше 500 личных рецептов.");
  return {
    recipes,
    photos: additions,
    favorites,
    shopping,
    conflicts,
    skipped,
  };
}
async function hash(blob: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
function encode(bytes: Uint8Array) {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192)
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(parts.join(""));
}
export async function exportBrowserData(repo: Repo) {
  const snapshot = await repo.snapshot();
  if (snapshot.photos.reduce((n, p) => n + p.blob.size, 0) > maxBinaryBytes)
    fail(
      "Полный backup превышает безопасный лимит: максимум 40 МиБ фотографий в одном файле. Экспорт отменён, данные не изменены.",
    );
  if (
    new Blob([JSON.stringify({ ...snapshot, photos: [] })]).size >
    maxBackupBytes / 4
  )
    fail("Слишком большой объём текстовых данных для полного экспорта.");
  const photos: PortableData["photos"] = [];
  for (const p of snapshot.photos) {
    await validateImage(p.blob);
    photos.push({
      schemaVersion: 1,
      id: p.id,
      recipeId: p.recipeId,
      mimeType: p.blob.type as PortableData["photos"][number]["mimeType"],
      encoding: "base64",
      data: encode(new Uint8Array(await p.blob.arrayBuffer())),
    });
  }
  const data = browserExport.parse({
    application: "culinote",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    recipes: snapshot.recipes,
    favorites: snapshot.favorites,
    shopping: snapshot.shopping,
    photos,
  });
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  if (blob.size > maxBackupBytes)
    fail("Полный backup больше 64 МиБ. Ничего не пропущено: экспорт отменён.");
  return {
    blob,
    date: data.createdAt,
    filename: `culinote-backup-${data.createdAt.slice(0, 10)}.json`,
  };
}
export async function prepareImport(file: Blob, repo: Repo) {
  if (!file.size || file.size > maxBackupBytes)
    fail("Файл должен быть не больше 64 МиБ.");
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    fail("Файл не содержит корректный JSON backup Culinote.");
  }
  const parsed = browserExport.safeParse(raw);
  if (!parsed.success)
    fail(
      "Некорректный или неподдерживаемый backup: проверьте версию, рецепты, фотографии и ссылки. Данные не изменены.",
    );
  const data = parsed.data!;
  const photos: StoredPhoto[] = [],
    hashes = new Map<string, string>();
  let total = 0;
  for (const p of data.photos) {
    const size =
      (p.data.length / 4) * 3 -
      (p.data.endsWith("==") ? 2 : p.data.endsWith("=") ? 1 : 0);
    if (size <= 0 || size > maxPhotoBytes || total + size > maxBinaryBytes)
      fail("Фотографии в backup превышают безопасный размер.");
    total += size;
    const binary = atob(p.data);
    if (btoa(binary) !== p.data) fail("Некорректный Base64 фотографии.");
    const blob = new Blob([Uint8Array.from(binary, (v) => v.charCodeAt(0))], {
      type: p.mimeType,
    });
    await validateImage(blob);
    photos.push({ schemaVersion: 1, id: p.id, recipeId: p.recipeId, blob });
    hashes.set(`new:${p.id}`, await hash(blob));
  }
  const target = await repo.snapshot();
  for (const old of target.photos)
    if (photos.some((p) => p.id === old.id))
      hashes.set(`old:${old.id}`, await hash(old.blob));
  const plan = mergePlan(target, data, photos, hashes);
  return {
    summary: {
      date: data.createdAt,
      recipes: plan.recipes.length,
      skipped: plan.skipped,
      photos: plan.photos.length,
      favorites: data.favorites.items.length,
      shoppingRows: data.shopping.recipes.length + data.shopping.manual.length,
      bytes: file.size,
      conflicts: plan.conflicts,
    },
    async confirm() {
      if (plan.conflicts.length)
        fail("Импорт отменён из-за конфликтов. Существующие данные сохранены.");
      await repo.restore(plan, target.revision);
    },
  };
}
