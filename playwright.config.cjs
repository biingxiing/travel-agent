// @ts-check
/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    headless: true,
  },
}
