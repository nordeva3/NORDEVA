import { test, expect } from "@playwright/test";

test.describe("NORDEVA public smoke checks", () => {
  test("home page loads without a fatal error", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/NORDEVA/i);
    await expect(page.locator("body")).toBeVisible();

    expect(consoleErrors.filter((error) => !/favicon|ResizeObserver/i.test(error))).toEqual([]);
  });

  test("browse route exposes marketplace search", async ({ page }) => {
    await page.goto("/browse");
    const search = page.getByRole("textbox", { name: /search/i }).first();
    await expect(search).toBeVisible();
    await search.fill("ai");
    await expect(search).toHaveValue("ai");
  });

  test("people discovery route exposes an accessible profile search", async ({ page }) => {
    await page.goto("/people");
    await expect(
      page.getByRole("heading", { name: /good work starts with the right people/i }),
    ).toBeVisible();
    const search = page.getByRole("searchbox", { name: /search marketplace profiles/i });
    await expect(search).toBeVisible();
    await search.fill("@sample_creator");
    await expect(search).toHaveValue("@sample_creator");
  });

  test("auth route renders login controls", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.locator("body")).toContainText(/sign in|login|email/i);
  });
});

test.describe("NORDEVA theme behavior", () => {
  test("theme toggle updates document theme and survives reload", async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("velora-theme")) localStorage.setItem("velora-theme", "dark");
    });
    await page.goto("/browse");
    const toggle = page.getByRole("button", { name: /toggle theme/i });
    await expect(toggle).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await toggle.click();
    await expect(page.locator("html")).toHaveClass(/light/);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("velora-theme")))
      .toBe("light");

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/light/);
    await expect(page.getByRole("button", { name: /toggle theme/i })).toBeVisible();
  });

  test("marketplace browse layout remains within mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/browse");
    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
});
