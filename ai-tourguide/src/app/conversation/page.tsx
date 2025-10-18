"use client";

import { useCallback, useMemo, useState, useRef, useEffect } from "react";

import { narrateToUser } from "@/lib/storytelling";
import { DEFAULT_WAKE_WORD, detectAndStripWakeWord } from "@/lib/wake-word";

type AnswerUserQuestionParams = {
  sessionId?: string | null;
  text: string;
  strippedText?: string;
  wakeWordDetected?: boolean;
  wakeWord?: string;
  placeName?: string;
  lat?: number;
  lng?: number;
};

export type AnswerUserQuestionResult = {
  sessionId: string | null;
  reply: string;
  ended: boolean;
  endReason: string | null;
  meta?: {
    turn?: number;
    lastSeenAt?: string | null;
    expiresAt?: string | null;
    detectedWakeWord?: boolean;
    knowledgeReferences?: string[];
    usedWebSearch?: boolean;
    webSearchNote?: string | null;
  };
};

export async function answerUserQuestion(
  params: AnswerUserQuestionParams
): Promise<AnswerUserQuestionResult> {
  const {
    sessionId = null,
    text,
    strippedText,
    wakeWordDetected,
    wakeWord = DEFAULT_WAKE_WORD,
    placeName,
    lat,
    lng,
  } = params;

  const response = await fetch("/api/conversation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      text,
      strippedText,
      wakeWordDetected,
      wakeWord,
      placeName,
      lat,
      lng,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error ?? "Failed to reach the tour guide.");
  }

  return {
    sessionId: data?.sessionId ?? null,
    reply: data?.reply ?? "",
    ended: Boolean(data?.ended),
    endReason: data?.endReason ?? null,
    meta: data?.meta,
  };
}

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

type SessionMetaState = {
  turn: number;
  lastSeenAt?: string | null;
  expiresAt?: string | null;
  detectedWakeWord?: boolean;
  usedWebSearch?: boolean;
  webSearchNote?: string | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultLike[];
}

interface SpeechRecognitionResultLike {
  [index: number]: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

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
  const [sessionMeta, setSessionMeta] = useState<SessionMetaState | null>(null);
  const [firstTurn, setFirstTurn] = useState<boolean>(true);

  // Voice listening state
  const [isVoiceListening, setIsVoiceListening] = useState<boolean>(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isVoiceActive, setIsVoiceActive] = useState<boolean>(false);
  const [voiceTranscript, setVoiceTranscript] = useState<string>("");
  const [isProcessingVoice, setIsProcessingVoice] = useState<boolean>(false);


  // Refs for voice functionality
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const lastSpeechAtRef = useRef<number>(0);
  const voiceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isVoiceActiveRef = useRef<boolean>(false);
  const currentVoiceTranscriptRef = useRef<string>("");

  // Voice listening timeout (3 seconds of silence)
  const VOICE_SILENCE_TIMEOUT = 5000;

  const effectiveWakeWord = useMemo(
    () => (wakeWord.trim() ? wakeWord.trim() : DEFAULT_WAKE_WORD),
    [wakeWord]
  );

  const formatIsoTimestamp = useCallback((value?: string | null) => {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return value;
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }, []);

  const conversationTurnCount = useMemo(() => {
    if (sessionMeta?.turn != null && sessionMeta.turn > 0) {
      return sessionMeta.turn;
    }
    return Math.floor(messages.length / 2);
  }, [messages, sessionMeta]);

  const quickPrompts = useMemo(
    () => [
      `${effectiveWakeWord}, what should I explore first at Jewel?`,
      "Can you suggest a dining option nearby?",
      "What time does the Rain Vortex show start?",
      "Any kid-friendly activities I should consider?",
      "What's a quiet spot to relax for a bit?",
    ],
    [effectiveWakeWord]
  );

  const recomputeWakeWordState = useCallback((input: string, hint: string) => {
    const detection = detectAndStripWakeWord(input, hint);
    setWakeWordDetected(detection.matched);
    setStrippedTranscript(detection.stripped);
    return detection;
  }, []);

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
    setSessionMeta(null);
    setFirstTurn(true); // Reset to first turn when manually resetting
  }, []);

  const sendTranscript = useCallback(
    async (overrideTranscript?: string) => {
      if (conversationEnded.ended) {
        setError("Session ended. Reset to start again.");
        return;
      }

      const rawTranscript =
        overrideTranscript !== undefined ? overrideTranscript : transcript;
      const trimmed = rawTranscript.trim();

      if (!trimmed) {
        setError("Provide a transcript before sending.");
        return;
      }

      console.log("rawTranscript", rawTranscript);
      const detection = detectAndStripWakeWord(
        rawTranscript,
        effectiveWakeWord
      );
      console.log("detection", detection);
      console.log("firstTurn", firstTurn);

      setWakeWordDetected(detection.matched);
      setStrippedTranscript(detection.stripped);

      if (detection.matched) {
        setFirstTurn(false);
      }

      if (firstTurn && !detection.matched) {
        setError(
          `Include the wake word (“${effectiveWakeWord}”) in the first message to start the session.`
        );
        return;
      }

      setIsSending(true);
      setError(null);

      try {
        const data = await answerUserQuestion({
          sessionId,
          text: rawTranscript,
          strippedText: detection.stripped,
          wakeWordDetected: detection.matched,
          wakeWord: effectiveWakeWord,
          placeName: placeName.trim() || undefined,
        });

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

        if (data?.reply) {
          void narrateToUser(data.reply).catch((playbackError) => {
            console.error("Failed to narrate assistant reply", playbackError);
          });
        }

        if (data?.meta) {
          setSessionMeta({
            turn: typeof data.meta.turn === "number" ? data.meta.turn : 0,
            lastSeenAt: data.meta.lastSeenAt ?? null,
            expiresAt: data.meta.expiresAt ?? null,
            detectedWakeWord: data.meta.detectedWakeWord,
            usedWebSearch: data.meta.usedWebSearch,
            webSearchNote: data.meta.webSearchNote ?? null,
          });
        }

        if (data?.ended) {
          setConversationEnded({
            ended: true,
            reason: data?.endReason ?? null,
          });
          setFirstTurn(true); // Reset to first turn when session expires
        } else {
          setConversationEnded({ ended: false, reason: null });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error.");
      } finally {
        setIsSending(false);
      }
    },
    [
      conversationEnded.ended,
      effectiveWakeWord,
      firstTurn,
      placeName,
      sessionId,
      transcript,
    ]
  );

  const handleQuickPrompt = useCallback(
    (prompt: string) => {
      void sendTranscript(prompt);
    },
    [sendTranscript]
  );


  // Voice listening functions
  const processVoiceTranscript = useCallback(
    async (voiceText: string) => {
      if (!voiceText.trim() || isProcessingVoice) {
        return;
      }

      setIsProcessingVoice(true);
      setVoiceTranscript("");
      currentVoiceTranscriptRef.current = "";
      setIsVoiceActive(false);
      isVoiceActiveRef.current = false;

      // Clear any pending timeout
      if (voiceTimeoutRef.current) {
        clearTimeout(voiceTimeoutRef.current);
        voiceTimeoutRef.current = null;
      }

      try {
        await sendTranscript(voiceText);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to process voice input"
        );
      } finally {
        setIsProcessingVoice(false);
      }
    },
    [sendTranscript, isProcessingVoice]
  );

  const startVoiceListening = useCallback(async () => {
    if (typeof window === "undefined") {
      setVoiceError("Voice listening not supported in this environment");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const speechWindow = window as SpeechRecognitionWindow;
      const SpeechRecognitionCtor =
        speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

      if (!SpeechRecognitionCtor) {
        setVoiceError(
          "Speech recognition not supported in this browser. Try Chrome on desktop."
        );
        return;
      }

      const recognition = new SpeechRecognitionCtor();
      recognition.lang = "en-SG";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const transcripts: string[] = [];

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result?.[0]?.transcript ?? "";
          if (transcript) {
            transcripts.push(transcript);
          }
        }

        if (!transcripts.length) {
          return;
        }

        const combinedRaw = transcripts.join(" ").trim();

        if (!combinedRaw) {
          return;
        }

        const detection = detectAndStripWakeWord(
          combinedRaw,
          effectiveWakeWord
        );
        const displayText = detection.matched
          ? detection.stripped || combinedRaw
          : combinedRaw;
        const now = Date.now();

        // Log words heard when waiting for wake word (yellow dot state)
        if (!isVoiceActiveRef.current) {
          console.log("🎤 Words heard (waiting for wake word):", combinedRaw);
        }

        // Update voice transcript for display
        setVoiceTranscript(displayText);
        currentVoiceTranscriptRef.current = combinedRaw;

        // Check for wake word detection
        if (detection.matched && !isVoiceActiveRef.current) {
          isVoiceActiveRef.current = true;
          setIsVoiceActive(true);
          const strippedText = detection.stripped || "";
          setVoiceTranscript(strippedText);
        }

        // Track speech activity
        if (detection.matched || isVoiceActiveRef.current) {
          lastSpeechAtRef.current = now;

          // Clear existing timeout
          if (voiceTimeoutRef.current) {
            clearTimeout(voiceTimeoutRef.current);
          }

          // Set new timeout for silence detection
          voiceTimeoutRef.current = setTimeout(() => {
            console.log("Voice timeout triggered:", {
              isVoiceActive: isVoiceActiveRef.current,
              transcript: currentVoiceTranscriptRef.current,
              hasContent: currentVoiceTranscriptRef.current.trim().length > 0,
            });
            if (
              isVoiceActiveRef.current &&
              currentVoiceTranscriptRef.current.trim()
            ) {
              console.log(
                "Processing voice transcript:",
                currentVoiceTranscriptRef.current
              );
              void processVoiceTranscript(currentVoiceTranscriptRef.current);
            }
          }, VOICE_SILENCE_TIMEOUT);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        setVoiceError(
          typeof event?.error === "string"
            ? `Speech recognition error: ${event.error}`
            : "Microphone listening error occurred."
        );
        setIsVoiceListening(false);
        isVoiceActiveRef.current = false;
        setIsVoiceActive(false);
      };

      recognition.onend = () => {
        if (isVoiceListening) {
          try {
            recognition.start();
          } catch (restartError) {
            console.warn("Unable to restart speech recognition", restartError);
            setVoiceError("Speech recognition stopped unexpectedly");
            setIsVoiceListening(false);
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsVoiceListening(true);
      setVoiceError(null);
    } catch (err) {
      setVoiceError(
        err instanceof Error ? err.message : "Failed to start voice listening"
      );
    }
  }, [effectiveWakeWord, processVoiceTranscript, isVoiceListening]);

  const stopVoiceListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (voiceTimeoutRef.current) {
      clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    }

    setIsVoiceListening(false);
    setIsVoiceActive(false);
    isVoiceActiveRef.current = false;
    setVoiceTranscript("");
    currentVoiceTranscriptRef.current = "";
    setVoiceError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopVoiceListening();
    };
  }, [stopVoiceListening]);

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

              {error ? <p className="text-xs text-rose-300">{error}</p> : null}

              <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Quick prompts
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Use these to exercise multi-turn flows quickly. The first
                  option includes the wake word automatically.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleQuickPrompt(prompt)}
                      className="rounded-full border border-slate-800/70 bg-slate-900/60 px-3 py-1 text-xs text-slate-200 transition hover:border-emerald-400 hover:text-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => sendTranscript()}
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

              {/* Voice Listening Controls */}
              <div className="rounded-xl border border-slate-800/60 bg-slate-950/50 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Voice Listening
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Start voice listening to automatically detect wake words and
                  send messages after silence.
                </p>

                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={
                        isVoiceListening
                          ? stopVoiceListening
                          : startVoiceListening
                      }
                      disabled={isProcessingVoice}
                      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 ${
                        isVoiceListening
                          ? "bg-red-500 text-red-950 hover:bg-red-400 focus:ring-red-500/50"
                          : "bg-blue-500 text-blue-950 hover:bg-blue-400 focus:ring-blue-500/50"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {isProcessingVoice ? (
                        <>
                          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          Processing...
                        </>
                      ) : isVoiceListening ? (
                        <>
                          <svg
                            className="mr-2 h-4 w-4"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                          Stop Listening
                        </>
                      ) : (
                        <>
                          <svg
                            className="mr-2 h-4 w-4"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                              clipRule="evenodd"
                            />
                          </svg>
                          Start Listening
                        </>
                      )}
                    </button>

                    <div className="flex items-center gap-2">
                      <div
                        className={`h-3 w-3 rounded-full ${
                          isVoiceListening
                            ? isVoiceActive
                              ? "bg-green-400 animate-pulse"
                              : "bg-yellow-400"
                            : "bg-slate-600"
                        }`}
                      />
                      <span className="text-xs text-slate-400">
                        {isVoiceListening
                          ? isVoiceActive
                            ? "Active - Listening for your message"
                            : "Waiting for wake word"
                          : "Not listening"}
                      </span>
                    </div>
                  </div>

                  {voiceTranscript && (
                    <div className="rounded-lg border border-slate-800/70 bg-slate-900/60 p-3">
                      <p className="text-xs text-slate-500">
                        Voice transcript:
                      </p>
                      <p className="mt-1 text-sm text-slate-200">
                        {voiceTranscript}
                      </p>
                    </div>
                  )}

                  {voiceError && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                      {voiceError}
                    </div>
                  )}
                </div>
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

            <div className="mt-6 rounded-xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs text-slate-400">
              <h3 className="text-sm font-semibold text-slate-100">
                Session diagnostics
              </h3>
              <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <dt className="uppercase tracking-wide text-slate-500">
                    Session ID
                  </dt>
                  <dd className="mt-1 break-all text-slate-100">
                    {sessionId ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-slate-500">
                    Turn count
                  </dt>
                  <dd className="mt-1 text-slate-100">
                    {conversationTurnCount || 0}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-slate-500">
                    Last seen
                  </dt>
                  <dd className="mt-1 text-slate-100">
                    {formatIsoTimestamp(sessionMeta?.lastSeenAt)}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-slate-500">
                    Expires at
                  </dt>
                  <dd className="mt-1 text-slate-100">
                    {formatIsoTimestamp(sessionMeta?.expiresAt)}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-slate-500">
                    Server wake word
                  </dt>
                  <dd className="mt-1 text-slate-100">
                    {sessionMeta?.detectedWakeWord === undefined
                      ? "—"
                      : sessionMeta.detectedWakeWord
                      ? "Yes"
                      : "No"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-slate-500">
                    Web search
                  </dt>
                  <dd className="mt-1 text-slate-100">
                    {sessionMeta?.usedWebSearch === undefined
                      ? "—"
                      : sessionMeta.usedWebSearch
                      ? sessionMeta.webSearchNote ?? "Used"
                      : "Not used"}
                  </dd>
                </div>
              </dl>
            </div>
          </aside>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
          <h2 className="text-lg font-semibold text-slate-100">
            Getting started
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-400">
            <li>
              <strong>Voice Mode:</strong> Click “Start Listening” to enable
              continuous voice recognition. Say the wake word (default: “
              {DEFAULT_WAKE_WORD}”) followed by your question. The system will
              automatically send your message after 3 seconds of silence.
            </li>
            <li>
              <strong>Text Mode:</strong> Type your message in the transcript
              field, starting with the wake word for the first message.
            </li>
            <li>
              Adjust the wake word if you want to test a different activation
              phrase.
            </li>
            <li>
              Subsequent turns may omit the wake word while the session is
              active.
            </li>
            <li>Use reset to clear the in-browser session and begin again.</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
