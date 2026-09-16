import { seedDemo } from "../src/modules/recipes/seed";
import { closePool } from "../src/platform/db/client";
try {
  await seedDemo();
  console.log("Demo seed complete. Existing records preserved.");
} catch {
  console.error(
    "Demo seed failed. Check migrations and database availability.",
  );
  process.exitCode = 1;
} finally {
  await closePool();
}
