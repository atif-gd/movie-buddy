"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatReply } from "@/lib/chat";
import { MovieCard } from "./MovieCard";

type Message = { role: "user" | "bot"; text: string; reply?: ChatReply };

const GREETING: Message = { role: "bot", text: "Hi! I'm your movie buddy. Tell me what you feel like watching." };

function sessionId() {
  try {
    let id = sessionStorage.getItem("sessionId");
    if (!id) sessionStorage.setItem("sessionId", (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    id.current ??= sessionId();
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id.current, message: text }),
      });
      const reply: ChatReply = res.ok
        ? await res.json()
        : { message: "Sorry, I couldn't read that. Please try again.", movies: [], followUp: null };
      setMessages((m) => [...m, { role: "bot", text: reply.message, reply }]);
    } catch {
      setMessages((m) => [...m, { role: "bot", text: "I can't reach the server. Please check your connection." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="chat">
      <header><h1>Movie Buddy</h1></header>
      <div className="messages" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <p>{m.text}</p>
            {m.reply?.movies.length ? (
              <div className="cards">{m.reply.movies.map((mv) => <MovieCard key={mv.id} movie={mv} />)}</div>
            ) : null}
            {m.reply?.followUp && <p className="follow-up">{m.reply.followUp}</p>}
          </div>
        ))}
        {busy && <div className="msg bot thinking">Thinking…</div>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. a funny 90s movie, no horror"
          aria-label="Message"
          maxLength={1000}
          disabled={busy}
          autoFocus
        />
        <button type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </main>
  );
}
