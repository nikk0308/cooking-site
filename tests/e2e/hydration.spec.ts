import { expect, test } from "../helpers/playwright";

test("recipe hydration gates interaction until JavaScript is ready", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    await scripts;
    await route.continue();
  });
  try {
    await page.goto("/recipes/syrniki", { waitUntil: "commit" });
    const servings = page.getByRole("spinbutton", {
      name: "Порции",
      exact: true,
    });
    await expect(page.getByText("500 г", { exact: true })).toBeVisible();
    await expect(servings).toBeDisabled();
    await expect(servings).toHaveValue("4");
    const add = page.getByRole("button", {
      name: "В список продуктов",
      exact: true,
    });
    await expect(add).toBeDisabled();
    release();
    await expect(servings).toBeEnabled();
    await expect(add).toBeEnabled();
    await servings.fill("6");
    await expect(page.getByText("750 г", { exact: true })).toBeVisible();
    await add.click();
    await expect(page.getByRole("status")).toContainText("Добавлено");
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});
