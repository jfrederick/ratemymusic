import { serve } from "@hono/node-server";
import { pushDaily, runDiscovery, runSync, setSetting } from "@rmm/core";
import { schedule } from "node-cron";
import { createApp } from "./app.js";
import { type AppDeps, buildDeps } from "./deps.js";

const deps = buildDeps();
const app = createApp(deps);

serve({ fetch: app.fetch, port: deps.config.port }, (info) => {
  console.log(`ratemymusic listening on http://127.0.0.1:${info.port}`);
});

function logCronError(deps: AppDeps, step: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[cron] ${step} failed: ${message}`);
  setSetting(deps.db, "last_cron_error", { step, message, at: new Date().toISOString() });
}

async function runDailyPipeline(): Promise<void> {
  try {
    const runSyncFn = deps.runSyncFn ?? runSync;
    await runSyncFn(deps.db, deps.scraper, {
      maxPages: 30,
      rymUsername: deps.config.rymUsername,
    });
  } catch (err) {
    logCronError(deps, "sync", err);
  }

  try {
    const runDiscoveryFn = deps.runDiscoveryFn ?? runDiscovery;
    await runDiscoveryFn(deps.db, { weights: deps.config.blendWeights });
  } catch (err) {
    logCronError(deps, "discover", err);
  }

  try {
    if (!deps.spotify) throw new Error("Spotify client unavailable");
    const pushDailyFn = deps.pushDailyFn ?? pushDaily;
    await pushDailyFn(deps.db, deps.spotify, {
      isConnected: () => deps.spotifyAuth.isConnected(),
    });
  } catch (err) {
    logCronError(deps, "push-daily", err);
  }
}

// Cron is off by default: the launchd CLI (packages/core's sync/discover/push-daily scripts) is
// the primary scheduling path for production. Set ENABLE_CRON=1 to run the daily pipeline
// in-process on this server instead (e.g. for deployments without launchd).
if (process.env.ENABLE_CRON === "1") {
  schedule("0 7 * * *", () => {
    runDailyPipeline().catch((err: unknown) => {
      console.error("[cron] unexpected pipeline failure:", err);
    });
  });
}
