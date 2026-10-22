import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    // database tests share one scratch SQLite file, so run test files one at a time
    fileParallelism: false,
  },
});
