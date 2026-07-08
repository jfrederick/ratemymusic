import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          root: "./packages/core",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "server",
          root: "./packages/server",
          environment: "node",
          include: ["test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "web",
          root: "./packages/web",
          environment: "jsdom",
          include: ["test/**/*.test.tsx"],
          setupFiles: ["./test/setup.ts"],
        },
      },
    ],
  },
});
