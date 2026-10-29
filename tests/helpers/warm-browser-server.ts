import { request, type FullConfig } from "@playwright/test";
import { Pool } from "pg";

export default async function warmServer(config: FullConfig) {
  const database = new URL(process.env.DATABASE_URL!);
  if (!/^recipes_v01_[a-f0-9]{32}$/.test(database.pathname.slice(1)))
    throw new Error(
      "Browser warmup requires the test runner's isolated database",
    );
  const pool = new Pool({ connectionString: database.href });
  const baseURL = config.projects[0].use.baseURL!;
  const api = await request.newContext({ baseURL });
  try {
    const login = await api.post("/api/admin/login", {
      headers: { Origin: baseURL },
      data: {
        email: process.env.E2E_ADMIN_EMAIL,
        password: process.env.E2E_ADMIN_PASSWORD,
      },
    });
    if (!login.ok()) throw new Error("Synthetic browser warmup login failed");
    const recipe = (
        await pool.query("SELECT id FROM recipes WHERE slug='syrniki'")
      ).rows[0].id,
      ingredient = (
        await pool.query("SELECT id FROM ingredients ORDER BY id LIMIT 1")
      ).rows[0].id;
    // Compile each shared client module before opening browser pages. Next dev
    // otherwise full-reloads an existing page when a new route first compiles,
    // racing unrelated browser navigations. Every response body is consumed;
    // no sleeps, retries or navigation errors are suppressed.
    for (const route of [
      "/",
      "/recipes/syrniki",
      "/my-recipes",
      "/my-recipes/new",
      `/my-recipes/${recipe}`,
      `/my-recipes/${recipe}/edit`,
      "/favorites",
      "/basket",
      "/admin/login",
      "/admin/recipes",
      "/admin/recipes/new",
      `/admin/recipes/${recipe}`,
      "/admin/categories",
      "/admin/ingredients",
      `/admin/ingredients/${ingredient}`,
      "/admin/ingredients/import",
      "/admin/logout",
    ]) {
      const response = await api.get(route);
      await response.body();
      if (
        response.status() !== 200 &&
        !(route === "/admin/logout" && response.status() === 405)
      )
        throw new Error(
          `Browser warmup failed for ${route}: ${response.status()}`,
        );
    }
    console.log("ISOLATED_BROWSER_ROUTE_COMPILATION=PASS");
  } finally {
    await api.dispose();
    await pool.end();
  }
}
