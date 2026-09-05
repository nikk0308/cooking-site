export type Liveness = Readonly<{ status: "ok" }>;
export function getLiveness(): Liveness {
  return { status: "ok" };
}
