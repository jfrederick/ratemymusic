import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "../config.js";
import { openDb } from "../db.js";
import { SpotifyAuth, SpotifyClient } from "../spotify/client.js";
import { pushDaily } from "../spotify/daily.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file lives at packages/core/{src,dist}/cli/push-daily.{ts,js}; walk up to the repo root.
const repoRoot = resolve(__dirname, "../../../../");
loadDotenv({ path: resolve(repoRoot, ".env"), quiet: true });

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const auth = new SpotifyAuth({
    db,
    clientId: config.spotifyClientId,
    redirectUri: `http://127.0.0.1:${config.port}/callback`,
  });

  if (!auth.isConnected()) {
    console.error(
      [
        "Spotify is not connected yet.",
        `Start the server (npm run dev -w @rmm/server) and complete the Spotify connect flow at http://127.0.0.1:${config.port}/, then re-run this command.`,
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const sp = new SpotifyClient({ auth });
  const result = await pushDaily(db, sp);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
