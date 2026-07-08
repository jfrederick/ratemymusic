import Anthropic from "@anthropic-ai/sdk";

/**
 * Narrow structural interface over the subset of the Anthropic SDK's streaming API that the
 * chat service needs. A real `Anthropic` client instance satisfies this interface (it has extra
 * members, which is fine structurally); tests inject a fake that implements only this shape, so
 * no real API calls are ever made in tests.
 */
export interface AnthropicStream {
  on(event: "text", listener: (delta: string) => void): unknown;
  finalMessage(): Promise<Anthropic.Message>;
}

export interface AnthropicClient {
  messages: {
    stream(params: Anthropic.MessageStreamParams): AnthropicStream;
  };
}

/** Real production wiring: wraps `new Anthropic({ apiKey })`. */
export function createAnthropicClient(apiKey: string): AnthropicClient {
  return new Anthropic({ apiKey });
}
