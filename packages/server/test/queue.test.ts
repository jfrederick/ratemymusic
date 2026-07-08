import { openDb } from "@rmm/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildTestDeps } from "./helpers.js";

describe("playlist queue", () => {
  it("starts empty", async () => {
    const db = openDb(":memory:");
    const app = createApp(buildTestDeps({ db }));
    const res = await app.request("/api/queue");
    expect(await res.json()).toEqual([]);
  });

  it("adds, dedupes, and removes albums", async () => {
    const db = openDb(":memory:");
    const app = createApp(buildTestDeps({ db }));

    const add1 = await app.request("/api/queue/1", { method: "POST" });
    expect(await add1.json()).toEqual([1]);

    const add2 = await app.request("/api/queue/2", { method: "POST" });
    expect(await add2.json()).toEqual([1, 2]);

    const addDupe = await app.request("/api/queue/1", { method: "POST" });
    expect(await addDupe.json()).toEqual([1, 2]);

    const remove = await app.request("/api/queue/1", { method: "DELETE" });
    expect(await remove.json()).toEqual([2]);

    const getRes = await app.request("/api/queue");
    expect(await getRes.json()).toEqual([2]);
  });
});
