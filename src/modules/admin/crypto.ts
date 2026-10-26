import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `s1:${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  if (!/^s1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded)) return false;
  const parts = encoded.split(":");
  return timingSafeEqual(
    await derive(password, parts[1]),
    Buffer.from(parts[2], "hex"),
  );
}
export const hashSessionToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newSessionToken = () => randomBytes(32).toString("hex");
export const absoluteSessionMs = 12 * 60 * 60 * 1000;
export const idleSessionMs = 60 * 60 * 1000;
export function sessionActive(
  session: { expiresAt: Date; lastSeenAt: Date; revokedAt: Date | null },
  now = new Date(),
) {
  return (
    !session.revokedAt &&
    session.expiresAt > now &&
    now.getTime() - session.lastSeenAt.getTime() < idleSessionMs
  );
}
