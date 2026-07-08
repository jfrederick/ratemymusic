import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createFakeAnthropicClient } from "./fakeAnthropic.js";
import { buildTestDeps } from "./helpers.js";

type SseEvent = { event: string; data: unknown };

/** Parses a raw `event: X\ndata: Y\n\n`-framed SSE body into a list of {event, data} objects. */
function parseSse(body: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of body.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice("event: ".length);
      else if (line.startsWith("data: ")) data = line.slice("data: ".length);
    }
    events.push({ event, data: JSON.parse(data) });
  }
  return events;
}

describe("POST /api/chat", () => {
  it("503s with a clear message when no ANTHROPIC_API_KEY is configured", async () => {
    const app = createApp(buildTestDeps({ anthropicClient: null }));
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "chat unavailable — set ANTHROPIC_API_KEY" });
  });

  it("400s when there are no messages", async () => {
    const { client } = createFakeAnthropicClient([{ text: "hi", stopReason: "end_turn" }]);
    const app = createApp(buildTestDeps({ anthropicClient: client }));
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("400s when there are more than 40 messages", async () => {
    const { client } = createFakeAnthropicClient([{ text: "hi", stopReason: "end_turn" }]);
    const app = createApp(buildTestDeps({ anthropicClient: client }));
    const messages = Array.from({ length: 41 }, () => ({ role: "user", content: "hi" }));
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    expect(res.status).toBe(400);
  });

  it("400s when a message exceeds 4000 characters", async () => {
    const { client } = createFakeAnthropicClient([{ text: "hi", stopReason: "end_turn" }]);
    const app = createApp(buildTestDeps({ anthropicClient: client }));
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(4001) }] }),
    });
    expect(res.status).toBe(400);
  });

  it("400s on an invalid message role", async () => {
    const { client } = createFakeAnthropicClient([{ text: "hi", stopReason: "end_turn" }]);
    const app = createApp(buildTestDeps({ anthropicClient: client }));
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "system", content: "hi" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("streams delta, tool, and done SSE events for a tool-calling turn", async () => {
    const { client } = createFakeAnthropicClient([
      {
        text: "Checking your taste...",
        toolUses: [{ id: "tu_1", name: "get_taste_profile", input: {} }],
        stopReason: "tool_use",
      },
      { text: "Here you go.", stopReason: "end_turn" },
    ]);
    const app = createApp(buildTestDeps({ anthropicClient: client }));

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "recommend something" }] }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = parseSse(await res.text());
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toEqual(["delta", "tool", "delta", "done"]);

    expect(events[0].data).toEqual({ text: "Checking your taste..." });
    expect(events[1].data).toEqual({ name: "get_taste_profile" });
    expect(events[2].data).toEqual({ text: "Here you go." });
    expect(events[3].data).toEqual({
      text: "Checking your taste...Here you go.",
      toolEvents: [{ name: "get_taste_profile", ok: true }],
    });
  });

  it("streams an error SSE event when runChat rejects", async () => {
    // Removing the client mid-flight isn't representative, but a broken tool call is: make the
    // fake client itself throw from finalMessage() to exercise the error path.
    const client = {
      messages: {
        stream() {
          return {
            on() {
              return this;
            },
            finalMessage() {
              return Promise.reject(new Error("boom"));
            },
          };
        },
      },
    };
    const app = createApp(buildTestDeps({ anthropicClient: client as never }));
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    const events = parseSse(await res.text());
    expect(events).toEqual([{ event: "error", data: { message: "boom" } }]);
  });
});
