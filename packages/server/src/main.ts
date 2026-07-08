import { serve } from "@hono/node-server";
import { createApp } from "./index.js";

const port = Number(process.env.PORT ?? 8787);
const app = createApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@rmm/server listening on http://127.0.0.1:${info.port}`);
});
