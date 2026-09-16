import { z } from "zod";
export async function boundedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max)
    throw new Error("Body too large");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
export async function readJson(request: Request) {
  return JSON.parse(
    new TextDecoder().decode(await boundedBody(request, 128 * 1024)),
  ) as unknown;
}
export function safeError(error: unknown) {
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: "Проверьте поля формы",
        fields: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 },
    );
  const code =
    (error as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (error as { code?: string })?.code;
  return Response.json(
    {
      error:
        code === "23505"
          ? "Такой адрес или название уже используется. Измените slug."
          : "Не удалось сохранить данные. Проверьте ввод и повторите попытку.",
    },
    { status: 400 },
  );
}
