import { credentials } from "../src/modules/admin/protection";
import { hashPassword } from "../src/modules/admin/crypto";
import { getDatabase, closePool } from "../src/platform/db/client";
import { adminUsers } from "../db/schema";
try {
  const v = credentials.parse({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  await getDatabase()
    .insert(adminUsers)
    .values({ email: v.email, passwordHash: await hashPassword(v.password) });
  console.log(
    "Admin created. Remove bootstrap credentials from the command environment.",
  );
} catch {
  console.error(
    "Admin creation failed. Check credentials, uniqueness, and database availability.",
  );
  process.exitCode = 1;
} finally {
  delete process.env.ADMIN_PASSWORD;
  await closePool();
}
