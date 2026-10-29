import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { chmod, readdir } from "node:fs/promises";
import path from "node:path";
import { fixture, testSha, state } from "./fixture";
import { isolatedDatabase } from "../helpers/database";
import {
  captureBackup,
  restoreBackup,
  run,
  inspectRuntime,
} from "../../scripts/backup/archive";
import inputs from "../../scripts/backup/build-inputs.json";

it("current runtime and exact v0.1 source rebuild start on restored v0.2; application-only rollback preserves extended catalog data", async () => {
  const current = process.env.RECOVERY_RUNTIME_IMAGE;
  const previous = process.env.RECOVERY_ROLLBACK_IMAGE;
  if (!current || !previous || process.platform !== "linux")
    throw new Error(
      "Explicit Linux isolated runtime/rollback images required; never silently skip",
    );
  const source = await fixture(),
    target = await isolatedDatabase(null);
  const media = path.join(source.root, "application-media");
  let mediaOwnedByRuntime = false;
  const mediaOwner = async (owner: string) =>
    run("docker", [
      "run",
      "--rm",
      "--label",
      "com.culinote.task=p68",
      "--read-only",
      "--user",
      "0",
      "--cap-drop",
      "ALL",
      "--cap-add",
      "CHOWN",
      "--mount",
      `type=bind,source=${media},target=/app/media`,
      "--entrypoint",
      "chown",
      current,
      owner,
      "/app/media",
    ]);
  try {
    source.options.runtime.image = await run("docker", [
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      current,
    ]);
    await captureBackup(source.options);
    await restoreBackup({
      pool: target.pool,
      container: source.options.container,
      database: new URL(target.url).pathname.slice(1),
      user: source.options.user,
      directory: source.options.destination,
      mediaDestination: media,
      policy: source.policy,
      runtimeSha: testSha,
      confirmIsolated: true,
    });
    // Only this synthetic fixture's mounted files are made readable to UID 10001.
    await chmod(media, 0o755);
    for (const name of await readdir(media))
      await chmod(path.join(media, name), 0o644);
    // Production permits writes only on its explicit media/cache/tmp mounts.
    // Readiness intentionally writes/removes a media probe. Keep rootfs read-only
    // but assign this synthetic directory to the actual runtime UID, not 0777.
    await mediaOwner("10001:10001");
    mediaOwnedByRuntime = true;
    for (const [image, sha] of [
      [current, testSha],
      [previous, inputs.inspectedV01GuardSha],
    ]) {
      const name = "culinote-recovery-app-" + randomUUID();
      try {
        await run("docker", [
          "run",
          "--detach",
          "--name",
          name,
          "--label",
          "com.culinote.task=p68",
          "--network",
          "host",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges:true",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=64m",
          "--tmpfs",
          "/app/.next/cache:rw,nosuid,size=64m,uid=10001,gid=10001",
          "--mount",
          `type=bind,source=${media},target=/app/media`,
          "--env",
          `DATABASE_URL=${target.url}`,
          "--env",
          "MEDIA_ROOT=/app/media",
          "--env",
          "PORT=3300",
          "--env",
          "HOSTNAME=127.0.0.1",
          image,
        ]);
        expect((await inspectRuntime(name)).sha).toBe(sha);
        expect(await run("docker", ["exec", name, "id", "-u"])).toBe("10001");
        expect(
          await run("docker", [
            "inspect",
            "--format",
            "{{.HostConfig.ReadonlyRootfs}}",
            name,
          ]),
        ).toBe("true");
        await expect
          .poll(
            async () => {
              try {
                return (await fetch("http://127.0.0.1:3300/api/health/ready"))
                  .status;
              } catch {
                return 0;
              }
            },
            { timeout: 30000, interval: 250 },
          )
          .toBe(200);
        expect(
          (await fetch("http://127.0.0.1:3300/api/health/live")).status,
        ).toBe(200);
        const detail = await fetch("http://127.0.0.1:3300/recipes/syrniki");
        expect(detail.status).toBe(200);
        expect(await detail.text()).toContain("syrniki");
        const key = (await readdir(media))[0];
        expect((await fetch("http://127.0.0.1:3300/media/" + key)).status).toBe(
          200,
        );
        const login = await fetch("http://127.0.0.1:3300/api/admin/login", {
          method: "POST",
          headers: {
            Origin: "https://127.0.0.1:3300",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: source.email,
            password: source.password,
          }),
        });
        expect(login.status).toBe(200);
        const cookie = login.headers.get("set-cookie")!.split(";")[0];
        const admin = await fetch("http://127.0.0.1:3300/admin/ingredients", {
          headers: { Cookie: cookie },
          redirect: "manual",
        });
        expect(admin.status).toBe(200);
        expect(await admin.text()).toContain("Synthetic recovery product");
        const before = await state(target.pool);
        // The v0.1 repository ignores additive category/provenance fields when
        // changing an unrelated ingredient field. Verify through its actual API.
        if (sha === inputs.inspectedV01GuardSha) {
          const nutrition = (
            await target.pool.query(
              'SELECT basis_quantity AS "basisQuantity",basis_unit_id AS "basisUnitId",calories_kcal AS "caloriesKcal",protein_g AS "proteinG",fat_g AS "fatG",carbohydrates_g AS "carbohydratesG",source_note AS "sourceNote" FROM ingredient_nutrition WHERE ingredient_id=$1',
              [source.ingredientId],
            )
          ).rows[0];
          const result = await fetch(
            "http://127.0.0.1:3300/api/admin/ingredients",
            {
              method: "POST",
              headers: {
                Origin: "https://127.0.0.1:3300",
                "Content-Type": "application/json",
                Cookie: cookie,
              },
              body: JSON.stringify({
                id: source.ingredientId,
                name: "Synthetic recovery product",
                slug: "synthetic-recovery-product",
                nutrition,
              }),
            },
          );
          expect(result.status).toBe(200);
          expect(
            (
              await target.pool.query(
                "SELECT source_identifier FROM ingredient_nutrition WHERE ingredient_id=$1",
                [source.ingredientId],
              )
            ).rows[0].source_identifier,
          ).toBe("synthetic:1");
          expect(
            (
              await target.pool.query(
                "SELECT category_id FROM ingredients WHERE id=$1",
                [source.ingredientId],
              )
            ).rows[0].category_id,
          ).not.toBeNull();
          expect(
            (
              await target.pool.query(
                "SELECT count(*)::int n FROM catalog_source_records WHERE ingredient_id=$1",
                [source.ingredientId],
              )
            ).rows[0].n,
          ).toBe(1);
          const bridgePolicy = {
            ...source.policy,
            rules: [
              ...source.policy.rules,
              {
                runtimeSha: sha,
                schemaHash: before.schemaHash,
                inventoryVersion: "v0.2" as const,
              },
            ],
          };
          const rollbackBackup = await captureBackup({
            ...source.options,
            pool: target.pool,
            database: new URL(target.url).pathname.slice(1),
            mediaRoot: media,
            destination: path.join(source.root, "rollback-runtime-backup"),
            runtime: await inspectRuntime(name),
            policy: bridgePolicy,
          });
          expect(rollbackBackup.manifest.source_sha).toBe(sha);
          expect(rollbackBackup.manifest.inventory_version).toBe("v0.2");
          expect(rollbackBackup.state.schema.tables).toHaveLength(14);
          expect(bridgePolicy.protectedRecoverySnapshot).toBe(
            source.policy.protectedRecoverySnapshot,
          );
        }
        expect((await state(target.pool)).schemaHash).toBe(before.schemaHash);
        console.log(
          `ISOLATED_APPLICATION_READY=PASS source=${sha}; REAL_OFFSITE_DRILL=PENDING_OWNER_AUTHORIZATION`,
        );
      } finally {
        await run("docker", ["rm", "--force", name]).catch(() => {});
      }
    }
  } finally {
    if (mediaOwnedByRuntime)
      await mediaOwner(`${process.getuid!()}:${process.getgid!()}`);
    await target.cleanup();
    await source.cleanup();
  }
}, 120000);
