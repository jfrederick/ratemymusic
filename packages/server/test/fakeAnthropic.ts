import type Anthropic from "@anthropic-ai/sdk";
import type { AnthropicClient, AnthropicStream } from "../src/chat/client.js";

export type FakeTurn = {
  text?: string;
  toolUses?: { id: string; name: string; input: unknown }[];
  stopReason: Anthropic.StopReason;
};

/**
 * Fake Anthropic client for tests: replays a fixed sequence of `FakeTurn`s, one per call to
 * `messages.stream(...)`. The last turn repeats if the loop calls `stream()` more times than
 * there are turns (used to exercise the iteration cap). Never makes a real API call.
 */
export function createFakeAnthropicClient(turns: FakeTurn[]): {
  client: AnthropicClient;
  calls: Anthropic.MessageStreamParams[];
} {
  const calls: Anthropic.MessageStreamParams[] = [];
  let index = 0;

  const client: AnthropicClient = {
    messages: {
      stream(params: Anthropic.MessageStreamParams): AnthropicStream {
        // Snapshot messages (the caller's array is mutated in place after this call returns).
        calls.push({ ...params, messages: [...params.messages] });
        const turn = turns[Math.min(index, turns.length - 1)];
        index++;

        let textListener: ((delta: string) => void) | undefined;

        return {
          on(event: "text", listener: (delta: string) => void) {
            if (event === "text") textListener = listener;
            return this;
          },
          async finalMessage(): Promise<Anthropic.Message> {
            if (turn.text && textListener) textListener(turn.text);

            const content: unknown[] = [];
            if (turn.text) {
              content.push({ type: "text", text: turn.text, citations: null });
            }
            for (const toolUse of turn.toolUses ?? []) {
              content.push({
                type: "tool_use",
                id: toolUse.id,
                name: toolUse.name,
                input: toolUse.input,
                caller: { type: "direct" },
              });
            }

            return {
              id: "msg_fake",
              type: "message",
              role: "assistant",
              model: params.model,
              content,
              stop_reason: turn.stopReason,
              stop_sequence: null,
              usage: {
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                cache_creation: null,
                server_tool_use: null,
                output_tokens_details: null,
              },
              container: null,
            } as unknown as Anthropic.Message;
          },
        };
      },
    },
  };

  return { client, calls };
}
