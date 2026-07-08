import { useEffect, useRef, useState } from "react";
import { type ChatMessage as ApiChatMessage, ApiError, streamChat } from "../api";
import { IconSend } from "../components/Icon";

type DisplayMessage = { id: number; role: "user" | "assistant"; content: string };
type ActiveTool = { id: number; name: string };

let nextMessageId = 1;
let nextToolId = 1;

function toolActivityLabel(name: string): string {
  switch (name) {
    case "get_taste_profile":
      return "checking your taste profile…";
    case "search_candidates":
      return "searching your graph…";
    case "scrape_genre_page":
      return "scraping RYM…";
    case "create_playlist":
      return "creating playlist…";
    default:
      return `running ${name}…`;
  }
}

export function Chat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeTools, setActiveTools] = useState<ActiveTool[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scrolls on new/streamed content.
  useEffect(() => {
    // Guarded: jsdom (unit tests) doesn't implement scrollIntoView.
    threadEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, streamingText]);

  const send = async () => {
    const content = input.trim();
    if (!content || sending || unavailable) return;

    const userMessage: DisplayMessage = { id: nextMessageId++, role: "user", content };
    const history: ApiChatMessage[] = [...messages, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError(null);
    setSending(true);
    setStreamingText("");
    setActiveTools([]);

    try {
      await streamChat(history, {
        onDelta: (text) => setStreamingText((current) => current + text),
        onTool: (name) => setActiveTools((current) => [...current, { id: nextToolId++, name }]),
        onDone: (result) => {
          setMessages((current) => [
            ...current,
            { id: nextMessageId++, role: "assistant", content: result.text },
          ]);
          setStreamingText("");
          setActiveTools([]);
        },
        onError: (message) => setError(message),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setUnavailable(true);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const newChat = () => {
    setMessages([]);
    setStreamingText("");
    setActiveTools([]);
    setError(null);
  };

  return (
    <div className="chat-page">
      <header className="page-header">
        <h1>Chat</h1>
        <div className="page-header__actions">
          <button type="button" className="btn btn--ghost" onClick={newChat}>
            New chat
          </button>
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}
      {unavailable && (
        <p className="error-banner">
          Chat isn't configured — set ANTHROPIC_API_KEY on the server to enable the music-discovery
          copilot.
        </p>
      )}

      <div className="chat-thread">
        {messages.length === 0 && !sending && (
          <p className="empty-state">
            Ask for something like "warm slowcore for a rainy Sunday" to get started.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble chat-bubble--${m.role}`}>
            {m.content}
          </div>
        ))}
        {sending && (
          <div className="chat-bubble chat-bubble--assistant">
            {activeTools.length > 0 && (
              <div className="chat-tool-chips">
                {activeTools.map((tool) => (
                  <span className="chat-tool-chip" key={tool.id}>
                    {toolActivityLabel(tool.name)}
                  </span>
                ))}
              </div>
            )}
            {streamingText}
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          rows={1}
          placeholder="Ask for a vibe, an artist, or a playlist…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending || unavailable}
        />
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void send()}
          disabled={sending || unavailable || input.trim() === ""}
          aria-label="Send"
        >
          <IconSend size={16} />
        </button>
      </div>
    </div>
  );
}
