import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chat } from "../src/pages/Chat";

/** Builds an SSE Response whose body trickles out one frame per pull() call, with a small real
 * delay between them so the test can observe intermediate (mid-stream) DOM states. */
function delayedSseResponse(frames: string[], status = 200): Response {
  let i = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= frames.length) {
        controller.close();
        return;
      }
      await new Promise((r) => setTimeout(r, 5));
      controller.enqueue(encoder.encode(frames[i]));
      i++;
    },
  });
  return new Response(stream, { status });
}

describe("Chat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams the assistant reply progressively, shows a tool activity chip mid-turn, and finalizes into a bubble", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          delayedSseResponse([
            'event: tool\ndata: {"name":"search_candidates"}\n\n',
            'event: delta\ndata: {"text":"Try "}\n\n',
            'event: delta\ndata: {"text":"Duster."}\n\n',
            'event: done\ndata: {"text":"Try Duster.","toolEvents":[{"name":"search_candidates","ok":true}]}\n\n',
          ]),
        ),
      ),
    );

    render(<Chat />);
    const textarea = screen.getByPlaceholderText(/ask for a vibe/i);
    fireEvent.change(textarea, { target: { value: "warm slowcore for a rainy sunday" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.getByText("warm slowcore for a rainy sunday")).not.toBeNull();

    await waitFor(() => expect(screen.getByText(/searching your graph/i)).not.toBeNull());
    await waitFor(() => expect(screen.getByText(/Try/)).not.toBeNull());
    await waitFor(() => {
      expect(screen.getByText("Try Duster.")).not.toBeNull();
      expect(screen.queryByText(/searching your graph/i)).toBeNull();
    });

    // Input is re-enabled once the turn completes.
    expect((textarea as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("sends on Enter (without Shift)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(delayedSseResponse(['event: done\ndata: {"text":"ok","toolEvents":[]}\n\n'])),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Chat />);
    const textarea = screen.getByPlaceholderText(/ask for a vibe/i);
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(screen.getByText("hello")).not.toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("ok")).not.toBeNull());
  });

  it("shows a disabled input with an explanatory note when the server returns 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "chat unavailable — set ANTHROPIC_API_KEY" }), {
            status: 503,
          }),
        ),
      ),
    );

    render(<Chat />);
    const textarea = screen.getByPlaceholderText(/ask for a vibe/i);
    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.getByText(/chat isn't configured/i)).not.toBeNull());
    expect((textarea as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("clears the thread on New chat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          delayedSseResponse(['event: done\ndata: {"text":"ok","toolEvents":[]}\n\n']),
        ),
      ),
    );

    render(<Chat />);
    const textarea = screen.getByPlaceholderText(/ask for a vibe/i);
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(screen.getByText("ok")).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /new chat/i }));

    expect(screen.queryByText("hello")).toBeNull();
    expect(screen.queryByText("ok")).toBeNull();
  });
});
