import { openDb } from "@rmm/core";
import { describe, expect, it } from "vitest";
import { ChatUnavailableError, runChat } from "../src/chat/service.js";
import { createFakeAnthropicClient } from "./fakeAnthropic.js";
import { buildTestDeps } from "./helpers.js";

describe("runChat", () => {
  it("throws ChatUnavailableError when no Anthropic client is configured", async () => {
    const deps = buildTestDeps({ anthropicClient: null });
    await expect(runChat(deps, [{ role: "user", content: "hi" }], () => {})).rejects.toThrow(
      ChatUnavailableError,
    );
  });

  it("forwards streamed text deltas via onDelta", async () => {
    const { client } = createFakeAnthropicClient([
      { text: "Hello there!", stopReason: "end_turn" },
    ]);
    const deps = buildTestDeps({ anthropicClient: client });

    const deltas: string[] = [];
    const result = await runChat(deps, [{ role: "user", content: "hi" }], (d) => deltas.push(d));

    expect(deltas).toEqual(["Hello there!"]);
    expect(result.text).toBe("Hello there!");
    expect(result.toolEvents).toEqual([]);
  });

  it("runs parallel tool_use blocks, sends ALL tool_results in one user message, and appends the assistant turn verbatim", async () => {
    const { client, calls } = createFakeAnthropicClient([
      {
        text: "Let me check.",
        toolUses: [
          { id: "tu_1", name: "get_taste_profile", input: {} },
          { id: "tu_2", name: "search_candidates", input: { genres: ["slowcore"] } },
        ],
        stopReason: "tool_use",
      },
      { text: "Here's what I found.", stopReason: "end_turn" },
    ]);
    const deps = buildTestDeps({ anthropicClient: client });

    const result = await runChat(
      deps,
      [{ role: "user", content: "recommend something" }],
      () => {},
    );

    expect(result.text).toBe("Let me check.Here's what I found.");
    expect(result.toolEvents).toEqual([
      { name: "get_taste_profile", ok: true },
      { name: "search_candidates", ok: true },
    ]);

    // Second call's messages: [user, assistant(verbatim w/ tool_use blocks), user(ALL tool_results)]
    expect(calls).toHaveLength(2);
    const secondCallMessages = calls[1].messages;
    expect(secondCallMessages).toHaveLength(3);
    expect(secondCallMessages[0]).toEqual({ role: "user", content: "recommend something" });

    const assistantTurn = secondCallMessages[1];
    expect(assistantTurn.role).toBe("assistant");
    const assistantContent = assistantTurn.content as { type: string }[];
    expect(assistantContent.map((b) => b.type)).toEqual(["text", "tool_use", "tool_use"]);

    const toolResultTurn = secondCallMessages[2];
    expect(toolResultTurn.role).toBe("user");
    const toolResultContent = toolResultTurn.content as { type: string; tool_use_id: string }[];
    expect(toolResultContent).toHaveLength(2);
    expect(toolResultContent.map((b) => b.tool_use_id)).toEqual(["tu_1", "tu_2"]);
  });

  it("marks a tool_result as an error and reports ok:false when the tool executor fails/is unknown", async () => {
    const { client } = createFakeAnthropicClient([
      {
        toolUses: [{ id: "tu_1", name: "create_playlist", input: { name: "x", albumIds: [1] } }],
        stopReason: "tool_use",
      },
      { text: "ok", stopReason: "end_turn" },
    ]);
    const deps = buildTestDeps({ anthropicClient: client }); // spotify not connected

    const result = await runChat(deps, [{ role: "user", content: "make a playlist" }], () => {});
    expect(result.toolEvents).toEqual([{ name: "create_playlist", ok: false }]);
  });

  it("fires onToolEvent as soon as a tool call begins", async () => {
    const { client } = createFakeAnthropicClient([
      { toolUses: [{ id: "tu_1", name: "get_taste_profile", input: {} }], stopReason: "tool_use" },
      { text: "done", stopReason: "end_turn" },
    ]);
    const deps = buildTestDeps({ anthropicClient: client });

    const seen: string[] = [];
    await runChat(
      deps,
      [{ role: "user", content: "hi" }],
      () => {},
      (name) => seen.push(name),
    );
    expect(seen).toEqual(["get_taste_profile"]);
  });

  it("caps the loop at 6 iterations when the model always returns tool_use", async () => {
    const { client, calls } = createFakeAnthropicClient([
      {
        toolUses: [{ id: "tu_x", name: "get_taste_profile", input: {} }],
        stopReason: "tool_use",
      },
    ]);
    const deps = buildTestDeps({ anthropicClient: client });

    const result = await runChat(deps, [{ role: "user", content: "hi" }], () => {});
    expect(calls).toHaveLength(6);
    expect(result.toolEvents).toHaveLength(6);
  });

  it("uses deps.anthropic.model and includes the taste-profile summary + cache_control in the system prompt", async () => {
    const db = openDb(":memory:");
    const { client, calls } = createFakeAnthropicClient([{ text: "hi", stopReason: "end_turn" }]);
    const deps = buildTestDeps({
      db,
      anthropicClient: client,
      anthropic: { apiKey: "x", model: "claude-sonnet-5" },
    });

    await runChat(deps, [{ role: "user", content: "hi" }], () => {});
    expect(calls[0].model).toBe("claude-sonnet-5");
    const system = calls[0].system as { type: string; text: string; cache_control?: unknown }[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[0].text).toContain("ratemymusic");
  });
});
