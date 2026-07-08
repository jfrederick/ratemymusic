import type Anthropic from "@anthropic-ai/sdk";
import type { AppDeps } from "../deps.js";
import { TOOL_DEFINITIONS, TOOL_EXECUTORS, buildSystemPrompt } from "./tools.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ToolEvent = { name: string; ok: boolean };
export type ChatResult = { text: string; toolEvents: ToolEvent[] };

/** Thrown by `runChat` when no Anthropic API key is configured (deps.anthropicClient is null). */
export class ChatUnavailableError extends Error {
  constructor() {
    super("chat unavailable — set ANTHROPIC_API_KEY");
    this.name = "ChatUnavailableError";
  }
}

const MAX_TOOL_ITERATIONS = 6;
const MAX_TOKENS = 4096;

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function isToolUse(block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock {
  return block.type === "tool_use";
}

/**
 * Runs the Claude tool loop for one chat turn: streams text deltas via `onDelta`, executes any
 * tool_use blocks against the local music graph (via TOOL_EXECUTORS), and loops -- sending ALL
 * tool_results from a turn back in a single user message -- until the model stops calling tools
 * or the iteration cap is hit. `onToolEvent`, if given, fires the moment each tool call begins
 * (before it resolves), so callers can surface "searching your graph..."-style activity in real
 * time; the same events are also returned (once resolved) in `toolEvents`.
 */
export async function runChat(
  deps: AppDeps,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  onToolEvent?: (name: string) => void,
): Promise<ChatResult> {
  const client = deps.anthropicClient;
  if (!client) throw new ChatUnavailableError();

  const system = buildSystemPrompt(deps.db);
  const anthMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const toolEvents: ToolEvent[] = [];
  let text = "";

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const stream = client.messages.stream({
      model: deps.anthropic.model,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: TOOL_DEFINITIONS,
      messages: anthMessages,
    });
    stream.on("text", (delta) => onDelta(delta));

    const response = await stream.finalMessage();
    text += extractText(response);

    // Append the assistant turn verbatim -- required so tool_use blocks (and their exact ids)
    // survive into the next request. Response content blocks (Anthropic.ContentBlock) are a
    // structurally compatible superset of request content blocks (Anthropic.ContentBlockParam)
    // for every block type we ever see here (text, tool_use).
    anthMessages.push({
      role: "assistant",
      content: response.content as unknown as Anthropic.MessageParam["content"],
    });

    if (response.stop_reason !== "tool_use") break;

    const toolUses = response.content.filter(isToolUse);
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      onToolEvent?.(toolUse.name);
      const executor = TOOL_EXECUTORS[toolUse.name];
      let ok: boolean;
      let content: string;
      if (!executor) {
        ok = false;
        content = `unknown tool: ${toolUse.name}`;
      } else {
        const result = await executor(deps, toolUse.input);
        ok = result.ok;
        content = result.ok ? JSON.stringify(result.data) : result.error;
      }
      toolEvents.push({ name: toolUse.name, ok });
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content,
        is_error: !ok,
      });
    }
    // ALL tool_results for this turn go back in ONE user message.
    anthMessages.push({ role: "user", content: toolResults });
  }

  return { text, toolEvents };
}
