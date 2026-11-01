import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { askVELORAAI } from "@/lib/lume-ai.functions";
import { Bot, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Msg = { role: "user" | "assistant"; content: string };

const GREETING: Msg = {
  role: "assistant",
  content:
    "Hi 👋 I'm NORDEVA AI. I can help only with NORDEVA Marketplace — buying, selling, accounts, listings, requests, downloads, and site policies.",
};
const STORAGE_KEY = "lume-ai-history";

function isValidMessage(value: unknown): value is Msg {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" &&
    item.content.trim().length > 0 &&
    item.content.length <= 4000
  );
}

function loadHistory(): Msg[] {
  if (typeof window === "undefined") return [GREETING];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const valid = parsed.filter(isValidMessage).slice(-50);
      if (valid.length > 0) return valid;
    }
  } catch {
    /* Ignore malformed/corrupted browser storage. */
  }
  return [GREETING];
}

export function VELORAAIChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ask = useServerFn(askVELORAAI);

  useEffect(() => setMessages(loadHistory()), []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
    } catch {
      /* ignore */
    }
  }, [messages]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const clearHistory = () => {
    setMessages([GREETING]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { reply } = await ask({ data: { messages: next.slice(-20) } });
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "NORDEVA AI is temporarily unavailable. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full lume-gradient text-white shadow-lg shadow-lume/30 grid place-items-center hover:scale-105 transition-transform"
          aria-label="Open NORDEVA AI chat"
        >
          <Bot className="size-6" />
        </button>
      )}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[92vw] max-w-sm h-[70vh] max-h-[560px] rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
            <div className="size-8 rounded-full lume-gradient grid place-items-center text-white">
              <Bot className="size-4" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">NORDEVA AI</div>
              <div className="text-[10px] text-muted-foreground">NORDEVA Marketplace assistant</div>
            </div>
            <button
              onClick={clearHistory}
              className="text-muted-foreground hover:text-foreground p-1"
              aria-label="Clear chat history"
            >
              <Trash2 className="size-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground p-1"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={`max-w-[85%] text-sm px-3 py-2 rounded-2xl whitespace-pre-wrap leading-relaxed ${m.role === "user" ? "lume-gradient text-white rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"}`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted text-muted-foreground text-xs px-3 py-2 rounded-2xl">
                  NORDEVA AI is thinking…
                </div>
              </div>
            )}
          </div>
          <form onSubmit={send} className="p-3 border-t border-border/60 flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about NORDEVA…"
              className="flex-1"
              maxLength={500}
              disabled={loading}
            />
            <Button
              type="submit"
              size="icon"
              disabled={loading || !input.trim()}
              className="lume-gradient text-white shrink-0"
            >
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
