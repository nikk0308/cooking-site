import { z } from "zod";
export const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(12).max(128),
});
export function sameOrigin(request: Request) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    return (
      origin.host === request.headers.get("host") &&
      (origin.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" && origin.protocol === "http:"))
    );
  } catch {
    return false;
  }
}
// One global bucket bounds memory and work, without trusting spoofable proxy IP headers.
let attempts: number[] = [];
export function allowLogin(now = Date.now()) {
  attempts = attempts.filter((t) => now - t < 60_000);
  if (attempts.length >= 10) return false;
  attempts.push(now);
  return true;
}
