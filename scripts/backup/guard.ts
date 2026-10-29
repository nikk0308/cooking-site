import { z } from "zod";
import type { Inventory } from "./inventory";
import inputs from "./build-inputs.json";
const sha = z.string().regex(/^[a-f0-9]{40}$/),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const releasePolicy = z
  .object({
    format: z.literal(1),
    toolSha: sha,
    rules: z
      .array(
        z
          .object({
            runtimeSha: sha,
            schemaHash: hash,
            inventoryVersion: z.enum(["v0.1", "v0.2"]),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    protectedRecoverySnapshot: z.literal(inputs.protectedRecoverySnapshot),
  })
  .strict();
export type ReleasePolicy = z.infer<typeof releasePolicy>;
export function checkGuard(raw: unknown, runtimeSha: string, state: Inventory) {
  const p = releasePolicy.parse(raw);
  sha.parse(runtimeSha);
  const rules = p.rules.filter(
    (r) =>
      r.runtimeSha === runtimeSha &&
      r.schemaHash === state.schemaHash &&
      r.inventoryVersion === state.schemaVersion,
  );
  if (rules.length !== 1)
    throw new Error("BACKUP_SHA_SCHEMA_PAIR_NOT_APPROVED");
  return rules[0];
}
export function checkBinding(
  raw: unknown,
  manifest: {
    source_sha: string;
    inventory_version: string;
    schema_hash: string;
    backup_tool_sha: string;
  },
  runtimeSha: string,
  state: Inventory,
) {
  if (
    manifest.backup_tool_sha !== releasePolicy.parse(raw).toolSha ||
    manifest.source_sha !== runtimeSha ||
    manifest.inventory_version !== state.schemaVersion ||
    manifest.schema_hash !== state.schemaHash
  )
    throw new Error("BACKUP_RUNTIME_INVENTORY_BINDING_MISMATCH");
  return checkGuard(raw, runtimeSha, state);
}
