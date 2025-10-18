"use client";

import { useCallback, useMemo, useState } from "react";

import {
  DEFAULT_WAKE_WORD,
  detectAndStripWakeWord,
} from "@/lib/wake-word";

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  meta?: {
    detectedWakeWord?: boolean;
    knowledgeReferences?: string[];
    usedWebSearch?: boolean;
    webSearchNote?: string | null;
    endReason?: string | null;
  };
};

function formatTimestamp(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
}

function createMessageId(prefix: string) {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ConversationPage() {
  const [wakeWord, setWakeWord] = useState<string>(DEFAULT_WAKE_WORD);
  const [transcript, setTranscript] = useState<string>("");
  const [strippedTranscript, setStrippedTranscript] = useState<string>("");
  const [wakeWordDetected, setWakeWordDetected] = useState<boolean>(false);
  const [placeName, setPlaceName] = useState<string>("Jewel Changi Airport");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationEnded, setConversationEnded] = useState<{
    ended: boolean;
    reason: string | null;
  }>({ ended: false, reason: null });

  const effectiveWakeWord = useMemo(
    () => (wakeWord.trim() ? wakeWord.trim() : DEFAULT_WAKE_WORD),
    [wakeWord]
  );

  const recomputeWakeWordState = useCallback(
    (input: string, hint: string) => {
      const detection = detectAndStripWakeWord(input, hint);
      setWakeWordDetected(detection.matched);
      setStrippedTranscript(detection.stripped);
      return detection;
    },
    []
  );

  const handleWakeWordChange = useCallback(
    (value: string) => {
      setWakeWord(value);
      recomputeWakeWordState(
        transcript,
        value.trim() ? value.trim() : DEFAULT_WAKE_WORD
      );
    },
    [recomputeWakeWordState, transcript]
  );

  const handleTranscriptChange = useCallback(
    (value: string) => {
      setTranscript(value);
      const hint = effectiveWakeWord;
      recomputeWakeWordState(value, hint);
      if (!value.trim()) {
        setError(null);
      }
    },
    [effectiveWakeWord, recomputeWakeWordState]
  );

  const resetConversation = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setTranscript("");
    setStrippedTranscript("");
    setWakeWordDetected(false);
    setIsSending(false);
    setError(null);
    setConversationEnded({ ended: false, reason: null });
  }, []);

  const sendTranscript = useCallback(async () => {
    if (conversationEnded.ended) {
      setError("Session ended. Reset to start again.");
      return;
    }

    const rawTranscript = transcript;
    const trimmed = rawTranscript.trim();

    if (!trimmed) {
      setError("Provide a transcript before sending.");
      return;
    }

    const detection = detectAndStripWakeWord(rawTranscript, effectiveWakeWord);
    const firstTurn = !sessionId;

    setWakeWordDetected(detection.matched);
    setStrippedTranscript(detection.stripped);

    if (firstTurn && !detection.matched) {
      setError(
        `Include the wake word (“${effectiveWakeWord}”) in the first message to start the session.`
      );
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          text: rawTranscript,
          strippedText: detection.stripped,
          wakeWordDetected: detection.matched,
          wakeWord: effectiveWakeWord,
          placeName: placeName.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to reach the tour guide.");
      }

      const userMessage: ConversationMessage = {
        id: createMessageId("user"),
        role: "user",
        text: detection.stripped.trim() || trimmed,
        timestamp: Date.now(),
        meta: {
          detectedWakeWord: detection.matched,
        },
      };

      const assistantMessage: ConversationMessage = {
        id: createMessageId("assistant"),
        role: "assistant",
        text: data?.reply ?? "",
        timestamp: Date.now(),
        meta: {
          knowledgeReferences: data?.meta?.knowledgeReferences ?? undefined,
          usedWebSearch: data?.meta?.usedWebSearch ?? undefined,
          webSearchNote: data?.meta?.webSearchNote ?? null,
          endReason: data?.endReason ?? null,
        },
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setSessionId(data?.sessionId ?? null);
      setTranscript("");
      setStrippedTranscript("");
      setWakeWordDetected(false);

      if (data?.ended) {
        setConversationEnded({
          ended: true,
          reason: data?.endReason ?? null,
        });
      } else {
        setConversationEnded({ ended: false, reason: null });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setIsSending(false);
    }
  }, [
    conversationEnded.ended,
    effectiveWakeWord,
    placeName,
    sessionId,
    transcript,
  ]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-6 py-10">
          <h1 className="text-3xl font-semibold sm:text-4xl">
            Conversation Wake Word Sandbox
          </h1>
          <p className="text-sm text-slate-400 sm:text-base">
            Try the wake word activation flow directly in the browser. Adjust
            the wake phrase, compose a transcript, and send it to the tour guide
            agent.
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <section className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-xl font-semibold">Wake word controls</h2>
            <p className="mt-2 text-sm text-slate-400">
              The first message in a session must include the wake word. Later
              messages can skip it if the session remains active.
            </p>

            <div className="mt-5 flex flex-col gap-4">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Wake word
                <input
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={wakeWord}
                  onChange={(event) => handleWakeWordChange(event.target.value)}
                  placeholder={DEFAULT_WAKE_WORD}
                  aria-label="Wake word"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Place name override
                <input
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={placeName}
                  onChange={(event) => setPlaceName(event.target.value)}
                  placeholder="Jewel Changi Airport"
                  aria-label="Place name"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Transcript
                <textarea
                  className="mt-1 h-32 w-full rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  value={transcript}
                  onChange={(event) =>
                    handleTranscriptChange(event.target.value)
                  }
                  placeholder="Hey Wei Jie, what should I explore first?"
                  aria-label="Transcript"
                />
              </label>

              <div className="rounded-xl border border-slate-800/60 bg-slate-950/70 p-4 text-sm text-slate-300">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-100">
                    Wake word detected?
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      wakeWordDetected
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "bg-slate-800/60 text-slate-400"
                    }`}
                  >
                    {wakeWordDetected ? "Yes" : "No"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {wakeWordDetected
                    ? strippedTranscript
                      ? `Forwarding without wake word: “${strippedTranscript}”.`
                      : "Wake word detected. Forwarding the wake phrase alone."
                    : `Waiting for the transcript to start with “${effectiveWakeWord}”.`}
                </p>
              </div>

              {error ? (
                <p className="text-xs text-rose-300">{error}</p>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={sendTranscript}
                  disabled={isSending}
                  className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:cursor-not-allowed disabled:bg-emerald-700/60"
                >
                  {isSending ? "Sending…" : "Send to tour guide"}
                </button>
                <button
                  type="button"
                  onClick={resetConversation}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-600/40"
                >
                  Reset session
                </button>
              </div>

              {sessionId ? (
                <p className="text-xs text-slate-500">
                  Session ID:{" "}
                  <span className="font-mono text-slate-300">{sessionId}</span>
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  Session will be created after the first valid request.
                </p>
              )}

              {conversationEnded.ended ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  Session ended: {conversationEnded.reason ?? "no reason given"}
                </div>
              ) : null}
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="text-lg font-semibold">Conversation log</h2>
            {messages.length ? (
              <ul className="mt-4 space-y-3 text-sm text-slate-300">
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className={`rounded-lg border border-slate-800/70 bg-slate-950/70 p-3 ${
                      message.role === "user"
                        ? "ring-1 ring-emerald-500/10"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-500">
                        {message.role === "user" ? "You" : "Tour guide"}
                      </span>
                      <span className="font-mono text-[11px] text-slate-600">
                        {formatTimestamp(message.timestamp)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-slate-100">
                      {message.text || "∅"}
                    </p>
                    {message.meta?.knowledgeReferences?.length ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Knowledge refs:{" "}
                        {message.meta.knowledgeReferences.join(", ")}
                      </p>
                    ) : null}
                    {message.meta?.webSearchNote ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {message.meta.webSearchNote}
                      </p>
                    ) : null}
                    {message.meta?.detectedWakeWord ? (
                      <p className="mt-1 text-xs text-emerald-300">
                        Wake word acknowledged.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">
                Messages will appear here after you send the first request.
              </p>
            )}
          </aside>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
          <h2 className="text-lg font-semibold text-slate-100">
            Getting started
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-400">
            <li>
              Start your first message with the wake word (default: “
              {DEFAULT_WAKE_WORD}”).
            </li>
            <li>
              Adjust the wake word if you want to test a different activation
              phrase.
            </li>
            <li>
              Subsequent turns may omit the wake word while the session is
              active.
            </li>
            <li>
              Use reset to clear the in-browser session and begin again.
            </li>
          </ol>
        </section>
      </main>
    </div>
  );
}
