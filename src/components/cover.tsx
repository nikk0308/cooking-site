/* eslint-disable @next/next/no-img-element -- controlled same-origin WebP media */
export function Cover({
  image,
  title,
}: {
  image?: { storageKey: string } | null;
  title: string;
}) {
  return image ? (
    <img
      className="cover"
      src={`/media/${image.storageKey}`}
      alt={title}
      loading="lazy"
    />
  ) : (
    <div
      className="cover placeholder"
      role="img"
      aria-label="Фото рецепта пока нет"
    >
      <span>Фото пока нет</span>
    </div>
  );
}
