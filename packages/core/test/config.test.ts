import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const config = loadConfig({});
    expect(config).toEqual({
      spotifyClientId: "40f98cc66e5b40e6a925dfa00e5bdbb1",
      anthropicApiKey: null,
      firecrawlApiKey: null,
      budgetDaily: 50,
      budgetInitial: 400,
      port: 8787,
      rymUsername: "jimbof36",
      dbPath: "data/rmm.sqlite",
      blendWeights: { list: 0.3, twin: 0.25, genre: 0.2, descriptor: 0.15, new: 0.1 },
    });
  });

  it("applies overrides from env", () => {
    const config = loadConfig({
      SPOTIFY_CLIENT_ID: "custom-client-id",
      ANTHROPIC_API_KEY: "sk-ant-123",
      FIRECRAWL_API_KEY: "fc-123",
      BUDGET_DAILY: "10",
      BUDGET_INITIAL: "100",
      PORT: "3000",
      RYM_USERNAME: "someone",
      RMM_DB_PATH: "/tmp/custom.sqlite",
      BLEND_WEIGHTS: '{"list":0.5,"twin":0.2,"genre":0.15,"descriptor":0.1,"new":0.05}',
    });
    expect(config.spotifyClientId).toBe("custom-client-id");
    expect(config.anthropicApiKey).toBe("sk-ant-123");
    expect(config.firecrawlApiKey).toBe("fc-123");
    expect(config.budgetDaily).toBe(10);
    expect(config.budgetInitial).toBe(100);
    expect(config.port).toBe(3000);
    expect(config.rymUsername).toBe("someone");
    expect(config.dbPath).toBe("/tmp/custom.sqlite");
    expect(config.blendWeights).toEqual({
      list: 0.5,
      twin: 0.2,
      genre: 0.15,
      descriptor: 0.1,
      new: 0.05,
    });
  });

  it("treats empty-string env values as absent, falling back to defaults", () => {
    const config = loadConfig({
      SPOTIFY_CLIENT_ID: "",
      ANTHROPIC_API_KEY: "",
      BUDGET_DAILY: "",
      PORT: "",
    });
    expect(config.spotifyClientId).toBe("40f98cc66e5b40e6a925dfa00e5bdbb1");
    expect(config.anthropicApiKey).toBeNull();
    expect(config.budgetDaily).toBe(50);
    expect(config.port).toBe(8787);
  });

  it("throws a descriptive error for an invalid number", () => {
    expect(() => loadConfig({ BUDGET_DAILY: "not-a-number" })).toThrow(/BUDGET_DAILY/);
  });

  it("throws a descriptive error for invalid JSON in BLEND_WEIGHTS", () => {
    expect(() => loadConfig({ BLEND_WEIGHTS: "{not json" })).toThrow(/BLEND_WEIGHTS/);
  });
});
