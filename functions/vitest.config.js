import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["bots/__tests__/**/*.test.js", "__tests__/**/*.test.js"],
  },
});
