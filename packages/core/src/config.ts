// The ONLY module that reads process.env. Everything else receives a Config value.

export type Config = {
  spotifyClientId: string;
  anthropicApiKey: string | null;
  firecrawlApiKey: string | null;
  budgetDaily: number;
  budgetInitial: number;
  port: number;
  rymUsername: string;
  dbPath: string;
  blendWeights: Record<"list" | "twin" | "genre" | "descriptor" | "new", number>;
};

const DEFAULT_SPOTIFY_CLIENT_ID = "40f98cc66e5b40e6a925dfa00e5bdbb1";
const DEFAULT_BUDGET_DAILY = 50;
const DEFAULT_BUDGET_INITIAL = 400;
const DEFAULT_PORT = 8787;
const DEFAULT_RYM_USERNAME = "jimbof36";
const DEFAULT_DB_PATH = "data/rmm.sqlite";
const DEFAULT_BLEND_WEIGHTS: Config["blendWeights"] = {
  list: 0.3,
  twin: 0.25,
  genre: 0.2,
  descriptor: 0.15,
  new: 0.1,
};

/** Returns undefined for both missing keys and empty-string values ("absent"). */
function readString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

function readNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = readString(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${key}: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function readBlendWeights(env: NodeJS.ProcessEnv): Config["blendWeights"] {
  const raw = readString(env, "BLEND_WEIGHTS");
  if (raw === undefined) return DEFAULT_BLEND_WEIGHTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in BLEND_WEIGHTS: ${reason}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid BLEND_WEIGHTS: expected a JSON object, got ${JSON.stringify(parsed)}`);
  }
  const keys = ["list", "twin", "genre", "descriptor", "new"] as const;
  const result = {} as Config["blendWeights"];
  for (const key of keys) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Invalid BLEND_WEIGHTS: missing or non-numeric "${key}" weight`);
    }
    result[key] = value;
  }
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    spotifyClientId: readString(env, "SPOTIFY_CLIENT_ID") ?? DEFAULT_SPOTIFY_CLIENT_ID,
    anthropicApiKey: readString(env, "ANTHROPIC_API_KEY") ?? null,
    firecrawlApiKey: readString(env, "FIRECRAWL_API_KEY") ?? null,
    budgetDaily: readNumber(env, "BUDGET_DAILY", DEFAULT_BUDGET_DAILY),
    budgetInitial: readNumber(env, "BUDGET_INITIAL", DEFAULT_BUDGET_INITIAL),
    port: readNumber(env, "PORT", DEFAULT_PORT),
    rymUsername: readString(env, "RYM_USERNAME") ?? DEFAULT_RYM_USERNAME,
    dbPath: readString(env, "RMM_DB_PATH") ?? DEFAULT_DB_PATH,
    blendWeights: readBlendWeights(env),
  };
}
