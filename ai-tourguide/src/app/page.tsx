"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { narratePointOfInterestAction } from "@/app/actions/narrate-point-of-interest";
import { answerUserQuestion } from "@/app/conversation/page";
import { userPreferences } from "@/data/user-preferences";
import {
  changiJewelKnowledgeBase,
  changiJewelMain,
  changiJewelRainVortex,
} from "@/data/changi-jewel";
import {
  PlaceOfInterest,
  generateStorytellingForPlaceOfInterest,
  narrateToUser,
  prepareUserPreferences,
} from "@/lib/storytelling";
import {
  type WakeWordDetectionResult,
  detectAndStripWakeWord,
  getWakeWord,
} from "@/lib/wake-word";
import { VOICE_CONFIG } from "@/services/voice/data";

type NarrationEntry = {
  poiId: string;
  poiName: string;
  story: string;
  timestamp: number;
};

const poiCatalog: PlaceOfInterest[] = [changiJewelMain, changiJewelRainVortex];
const WAKE_WORD_RESET_MS = 4_000;
const BROWSER_SESSION_STORAGE_KEY = "ai-tourguide:browser-session-id";

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
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
}

interface SpeechRecognitionResultLike {
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
  isFinal?: boolean;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}
const preparedPreferences = prepareUserPreferences(userPreferences);

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return "—";
  }

  return new Date(timestamp).toLocaleTimeString();
}

function isMeaningfulSpeech(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }

  const alphanumeric = trimmed.replace(/[^a-z0-9]+/gi, "");
  if (alphanumeric.length >= 3) {
    return true;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

export default function StorytellerPage() {
  const [selectedPoiId, setSelectedPoiId] = useState<string>(
    poiCatalog[0]?.id ?? ""
  );
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(
    Object.values(VOICE_CONFIG)[0]?.id ?? ""
  );
  const [latestStory, setLatestStory] = useState<string>("");
  const [isNarrating, setIsNarrating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [narrationLog, setNarrationLog] = useState<NarrationEntry[]>([]);
  const [wakeWordDetectedAt, setWakeWordDetectedAt] = useState<number | null>(
    null
  );
  const [wakeWordPhrase, setWakeWordPhrase] = useState<string>("");
  const [isMicListening, setIsMicListening] = useState<boolean>(false);
  const [micError, setMicError] = useState<string | null>(null);
  const browserSessionIdRef = useRef<string | null>(null);
  const knowledge = changiJewelKnowledgeBase;
  const overviewBullets = knowledge.overview.bullets?.slice(0, 3) ?? [];
  const quickFactCards = knowledge.quickFacts.slice(0, 6);
  const historyHighlights = knowledge.history.slice(0, 4);
  const featuredFaqs = knowledge.faqs.slice(0, 3);
  const personaExtras = preparedPreferences.extras;
  const hasPersonaExtras = Object.keys(personaExtras).length > 0;

  const toneDisplay = (() => {
    const rawTone =
      typeof userPreferences.preferredTone === "string"
        ? userPreferences.preferredTone.trim()
        : "";
    const normalized = preparedPreferences.preferredTone;
    if (rawTone && rawTone.toLowerCase() !== normalized) {
      return `${toTitleCase(rawTone)} → ${toTitleCase(normalized)}`;
    }
    return toTitleCase(normalized);
  })();

  const paceDisplay = (() => {
    const rawPace =
      typeof userPreferences.preferredPace === "string"
        ? userPreferences.preferredPace.trim()
        : "";
    const normalized = preparedPreferences.preferredPace;
    if (rawPace && rawPace.toLowerCase() !== normalized) {
      return `${toTitleCase(rawPace)} → ${toTitleCase(normalized)}`;
    }
    return toTitleCase(normalized);
  })();

  const selectedPoi = useMemo(() => {
    return poiCatalog.find((poi) => poi.id === selectedPoiId) ?? null;
  }, [selectedPoiId]);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const wakeWordPausedRef = useRef<boolean>(false);
  const isHandlingWakeWordRef = useRef<boolean>(false);
  const activeWakeWord = useMemo(() => getWakeWord(), []);

  const ensureBrowserSessionId = useCallback((): string => {
    if (browserSessionIdRef.current) {
      return browserSessionIdRef.current;
    }

    const makeId = () => {
      if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
      ) {
        return crypto.randomUUID();
      }
      return `session-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
    };

    const fallbackId = makeId();

    if (typeof window === "undefined") {
      browserSessionIdRef.current = fallbackId;
      return fallbackId;
    }

    try {
      const stored = window.sessionStorage.getItem(BROWSER_SESSION_STORAGE_KEY);

      if (stored) {
        browserSessionIdRef.current = stored;
        return stored;
      }

      window.sessionStorage.setItem(BROWSER_SESSION_STORAGE_KEY, fallbackId);
      browserSessionIdRef.current = fallbackId;
      return fallbackId;
    } catch (storageError) {
      console.warn(
        "Unable to access sessionStorage for session id",
        storageError
      );
      browserSessionIdRef.current = fallbackId;
      return fallbackId;
    }
  }, []);

  const listenToUser = useCallback(
    async (initialTranscript: string): Promise<string | null> => {
      if (typeof window === "undefined") {
        const fallback = initialTranscript.trim();
        return fallback.length ? fallback : null;
      }

      const speechWindow = window as SpeechRecognitionWindow;
      const SpeechRecognitionCtor =
        speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

      if (!SpeechRecognitionCtor) {
        setMicError(
          "Speech recognition isn't supported in this browser. Try Chrome on desktop."
        );
        const fallback = initialTranscript.trim();
        return fallback.length ? fallback : null;
      }

      const SILENCE_TIMEOUT_MS = 1_500;
      const MAX_LISTEN_MS = 10_000;

      return new Promise<string | null>((resolve) => {
        const recognition = new SpeechRecognitionCtor();
        recognition.lang = "en-SG";
        recognition.continuous = true;
        recognition.interimResults = true;

        const finalSegments: string[] = [];
        const seed = initialTranscript.trim();
        if (seed) {
          finalSegments.push(seed);
        }
        let interimSegment = "";
        let silenceTimer: number | null = null;
        let maxTimer: number | null = null;
        let resolved = false;

        const cleanup = () => {
          if (silenceTimer !== null) {
            window.clearTimeout(silenceTimer);
            silenceTimer = null;
          }
          if (maxTimer !== null) {
            window.clearTimeout(maxTimer);
            maxTimer = null;
          }
          recognition.onresult = null;
          recognition.onerror = null;
          recognition.onend = null;
        };

        const normaliseText = () => {
          const segments = [...finalSegments];
          const interim = interimSegment.trim();
          if (interim) {
            segments.push(interim);
          }
          return segments.join(" ").replace(/\s+/g, " ").trim();
        };

        const finish = () => {
          if (resolved) {
            return;
          }
          resolved = true;
          cleanup();
          try {
            recognition.stop();
          } catch (stopError) {
            console.warn("Error stopping user speech recognition", stopError);
          }
          const text = normaliseText();
          resolve(text.length ? text : null);
        };

        const scheduleSilenceTimer = () => {
          if (silenceTimer !== null) {
            window.clearTimeout(silenceTimer);
          }
          silenceTimer = window.setTimeout(finish, SILENCE_TIMEOUT_MS);
        };

        recognition.onresult = (event: SpeechRecognitionEventLike) => {
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            const transcript = result?.[0]?.transcript ?? "";
            if (!transcript) {
              continue;
            }
            const trimmed = transcript.trim();
            if (result?.isFinal) {
              if (
                !finalSegments.length ||
                finalSegments[finalSegments.length - 1] !== trimmed
              ) {
                finalSegments.push(trimmed);
              }
              interimSegment = "";
            } else {
              interimSegment = trimmed;
            }
          }

          scheduleSilenceTimer();
        };

        recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
          const errorKey = event?.error;
          if (typeof errorKey === "string" && errorKey === "no-speech") {
            console.info("Speech recognition detected no speech input.");
            setMicError(null);
          } else {
            console.warn(
              "Speech recognition error while listening to the user",
              event
            );
            setMicError(
              typeof errorKey === "string"
                ? `Speech recognition error: ${errorKey}`
                : "Microphone listening error occurred."
            );
          }
          finish();
        };

        recognition.onend = () => {
          finish();
        };

        try {
          recognition.start();
          maxTimer = window.setTimeout(finish, MAX_LISTEN_MS);
        } catch (startError) {
          console.warn(
            "Unable to start follow-up speech recognition",
            startError
          );
          cleanup();
          const fallback = seed;
          resolve(fallback.length ? fallback : null);
        }
      });
    },
    [setMicError]
  );

  const handleWakeWordMatch = useCallback(
    async (detection: WakeWordDetectionResult) => {
      if (isHandlingWakeWordRef.current) {
        return;
      }

      isHandlingWakeWordRef.current = true;
      wakeWordPausedRef.current = true;

      const sessionId = ensureBrowserSessionId();
      console.info("[OpenAI][AgentCall] wake word detected", {
        sessionId,
        wakeWord: detection.wakeWord,
        strippedPreview: detection.stripped?.slice(0, 80) ?? null,
      });

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (stopError) {
          console.warn("Error stopping wake word recognition", stopError);
        }
      }

      setIsMicListening(false);

      try {
        const callAgent = async (
          rawText: string,
          strippedText: string,
          wakeWordUsed: boolean
        ) => {
          const preview = rawText.slice(0, 120);
          console.info("[OpenAI][AgentCall] requesting", {
            sessionId,
            wakeWordUsed,
            preview,
          });

          const agentResponse = await answerUserQuestion({
            sessionId,
            text: rawText,
            strippedText,
            wakeWordDetected: wakeWordUsed,
            wakeWord: activeWakeWord,
            placeName: selectedPoi?.name,
          });

          console.info("[OpenAI][AgentCall] completed", {
            sessionId,
            wakeWordUsed,
            preview,
            ended: agentResponse.ended,
            replyPresent: Boolean(agentResponse.reply),
          });

          setMicError(null);

          if (agentResponse.reply) {
            await narrateToUser(agentResponse.reply);
          }

          return agentResponse;
        };

        const capturedSpeech = await listenToUser(detection.stripped ?? "");
        const trimmedSpeech = capturedSpeech?.replace(/\s+/g, " ").trim();

        if (!trimmedSpeech || !isMeaningfulSpeech(trimmedSpeech)) {
          console.info(
            "[OpenAI][AgentCall] skipped due to non-meaningful speech",
            {
              sessionId,
              wakeWord: detection.wakeWord,
            }
          );
          return;
        }

        const rawQuestion = [detection.wakeWord, trimmedSpeech]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        let initialResponse;
        try {
          initialResponse = await callAgent(rawQuestion, trimmedSpeech, true);
        } catch (agentError) {
          console.error("[OpenAI][AgentCall] failed", {
            sessionId,
            wakeWordUsed: true,
            preview: rawQuestion.slice(0, 120),
            error: agentError,
          });
          throw agentError;
        }

        if (initialResponse.ended) {
          return;
        }

        while (true) {
          const followUpRaw = await listenToUser("");
          const followUp = followUpRaw?.replace(/\s+/g, " ").trim();

          if (!followUp || !isMeaningfulSpeech(followUp)) {
            break;
          }

          try {
            const followUpResponse = await callAgent(followUp, followUp, false);

            if (followUpResponse.ended) {
              break;
            }
          } catch (agentError) {
            console.error("[OpenAI][AgentCall] follow-up failed", {
              sessionId,
              wakeWordUsed: false,
              preview: followUp.slice(0, 120),
              error: agentError,
            });
            break;
          }
        }
      } catch (error) {
        console.error("Failed to process wake word conversation", error);
        setMicError(
          error instanceof Error
            ? error.message
            : "Unable to process your request right now."
        );
      } finally {
        wakeWordPausedRef.current = false;
        isHandlingWakeWordRef.current = false;
        setWakeWordDetectedAt(null);
        setWakeWordPhrase("");

        if (recognitionRef.current) {
          try {
            recognitionRef.current.start();
            setIsMicListening(true);
          } catch (restartError) {
            console.warn(
              "Unable to restart wake word recognition after conversation",
              restartError
            );
            setMicError(
              "Microphone listener stopped unexpectedly. Reload to retry."
            );
          }
        }
      }
    },
    [activeWakeWord, ensureBrowserSessionId, listenToUser, selectedPoi]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const initialise = async () => {
      const speechWindow = window as SpeechRecognitionWindow;
      const SpeechRecognitionCtor =
        speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

      if (!SpeechRecognitionCtor) {
        setMicError(
          "Wake word listening isn't supported in this browser. Try Chrome on desktop."
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        mediaStreamRef.current = stream;

        const recognition = new SpeechRecognitionCtor();
        recognition.lang = "en-SG";
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event: SpeechRecognitionEventLike) => {
          if (wakeWordPausedRef.current || isHandlingWakeWordRef.current) {
            return;
          }

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

          const combined = transcripts.join(" ");
          const detection = detectAndStripWakeWord(combined, activeWakeWord);

          if (detection.matched) {
            setWakeWordPhrase(detection.wakeWord);
            setWakeWordDetectedAt(Date.now());
            void handleWakeWordMatch(detection);
          }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
          if (!cancelled) {
            setMicError(
              typeof event?.error === "string"
                ? `Speech recognition error: ${event.error}`
                : "Microphone listening error occurred."
            );
            setIsMicListening(false);
          }
        };

        recognition.onend = () => {
          if (!cancelled && !wakeWordPausedRef.current) {
            try {
              recognition.start();
            } catch (restartError) {
              console.warn(
                "Unable to restart speech recognition",
                restartError
              );
            }
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
        setIsMicListening(true);
      } catch (requestError) {
        if (!cancelled) {
          setMicError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to access microphone."
          );
          setIsMicListening(false);
        }
      }
    };

    initialise();

    return () => {
      cancelled = true;
      setIsMicListening(false);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
        } catch (stopError) {
          console.warn("Error stopping speech recognition", stopError);
        }
      }
      recognitionRef.current = null;

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      mediaStreamRef.current = null;
    };
  }, [activeWakeWord, handleWakeWordMatch]);

  useEffect(() => {
    ensureBrowserSessionId();
  }, [ensureBrowserSessionId]);

  useEffect(() => {
    if (!wakeWordDetectedAt) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setWakeWordDetectedAt(null);
      setWakeWordPhrase("");
    }, WAKE_WORD_RESET_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [wakeWordDetectedAt]);

  const recordNarration = (story: string, poi: PlaceOfInterest) => {
    setLatestStory(story);
    setNarrationLog((prev) =>
      [
        {
          poiId: poi.id,
          poiName: poi.name,
          story,
          timestamp: Date.now(),
        },
        ...prev,
      ].slice(0, 12)
    );
  };

  const speakPointOfInterest = async (poi: PlaceOfInterest | null) => {
    if (!poi) {
      setError("Select a point of interest to continue.");
      return;
    }

    setError(null);
    setIsNarrating(true);

    try {
      const story = await narratePointOfInterestAction({
        poi,
        preferences: userPreferences,
      });

      recordNarration(story, poi);

      const voiceOptions = selectedVoiceId
        ? { voiceId: selectedVoiceId }
        : undefined;

      await narrateToUser(story, voiceOptions);
    } catch (untypedError) {
      console.error("AI narration failed", untypedError);

      const fallbackStory = generateStorytellingForPlaceOfInterest(
        userPreferences,
        poi
      );

      recordNarration(fallbackStory, poi);

      const message =
        untypedError instanceof Error
          ? `AI narrator unavailable. Showing template narration instead. (${untypedError.message})`
          : "AI narrator unavailable. Showing template narration instead.";

      setError(message);

      const voiceOptions = selectedVoiceId
        ? { voiceId: selectedVoiceId }
        : undefined;

      await narrateToUser(fallbackStory, voiceOptions);
    } finally {
      setIsNarrating(false);
    }
  };

  const handleQuickNarrate = async (poi: PlaceOfInterest) => {
    setSelectedPoiId(poi.id);
    await speakPointOfInterest(poi);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-10">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold sm:text-4xl">
              AI Tour Guide Story Studio
            </h1>
            <p className="text-sm text-slate-400 sm:text-base">
              Craft narrated micro-adventures for Changi Jewel at the tap of a
              button—no live geofencing required.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-xl font-semibold">Story controls</h2>
                <p className="text-sm text-slate-400">
                  Pick a landmark inside Changi Jewel, then generate a tailored
                  narration using the traveller’s preferences.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-slate-200">
                    <span className="font-semibold">Wake word listener</span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          micError
                            ? "bg-rose-500/20 text-rose-200"
                            : isMicListening
                            ? "bg-emerald-500/10 text-emerald-200"
                            : "bg-slate-800 text-slate-400"
                        }`}
                        aria-live="polite"
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            micError
                              ? "bg-rose-300"
                              : isMicListening
                              ? "bg-emerald-400 animate-pulse"
                              : "bg-slate-500"
                          }`}
                        />
                        {micError
                          ? "Error"
                          : isMicListening
                          ? "Listening"
                          : "Idle"}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Wake word:
                        <span className="ml-1 text-slate-200">
                          “{activeWakeWord}”
                        </span>
                      </span>
                    </span>
                  </p>
                  {micError ? (
                    <p className="mt-1 text-rose-300">{micError}</p>
                  ) : (
                    <p className="mt-1 text-slate-400">
                      {isMicListening ? (
                        <>
                          Microphone open. Say
                          <span className="mx-1 rounded-sm bg-slate-800 px-1.5 py-0.5 font-medium text-slate-200">
                            “{activeWakeWord}”
                          </span>
                          to jump straight into narration.
                        </>
                      ) : (
                        "Setting up microphone access."
                      )}
                    </p>
                  )}
                  {wakeWordDetectedAt ? (
                    <div className="mt-2 rounded-md border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-emerald-200">
                      Wake word “
                      {wakeWordPhrase || activeWakeWord || "Detected"}” just
                      fired at{" "}
                      {new Date(wakeWordDetectedAt).toLocaleTimeString()}.
                    </div>
                  ) : null}
                </div>

                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Voice model
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    value={selectedVoiceId}
                    onChange={(event) => setSelectedVoiceId(event.target.value)}
                    aria-label="Voice model"
                  >
                    {Object.entries(VOICE_CONFIG).map(([name, config]) => (
                      <option key={config.id} value={config.id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>

                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Quick narrations
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {poiCatalog.map((poi) => {
                    const isActive = poi.id === selectedPoiId;
                    return (
                      <button
                        key={poi.id}
                        type="button"
                        className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-500/60 disabled:cursor-not-allowed ${
                          isActive
                            ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                            : "bg-slate-800/80 text-slate-100 hover:bg-slate-700/70"
                        }`}
                        onClick={() => handleQuickNarrate(poi)}
                        disabled={isNarrating}
                        aria-pressed={isActive}
                      >
                        {isActive && isNarrating
                          ? "Narrating..."
                          : `Narrate ${poi.name}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedPoi ? (
                <div className="rounded-xl border border-slate-800/60 bg-slate-950/70 p-4 text-sm text-slate-300">
                  <h3 className="text-sm font-semibold text-slate-100">
                    {selectedPoi.name}
                  </h3>
                  <p className="mt-2 text-slate-400">{selectedPoi.summary}</p>
                  <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Highlights
                  </h4>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-400">
                    {selectedPoi.highlights.map((highlight) => (
                      <li key={highlight}>{highlight}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {error ? <p className="text-xs text-rose-300">{error}</p> : null}
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-lg font-semibold">Traveller profile</h2>
            <dl className="mt-4 space-y-2 text-sm text-slate-300">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Name</dt>
                <dd className="font-medium text-slate-100">
                  {userPreferences.travelerName ??
                    preparedPreferences.travelerName}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Companions</dt>
                <dd className="max-w-[60%] text-right text-slate-100">
                  {preparedPreferences.tripCompanions.length
                    ? preparedPreferences.tripCompanions.join(", ")
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Interests</dt>
                <dd className="max-w-[60%] text-right text-slate-100">
                  {preparedPreferences.interests.length
                    ? preparedPreferences.interests.join(", ")
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Tone</dt>
                <dd className="text-slate-100">{toneDisplay}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Pace</dt>
                <dd className="text-slate-100">{paceDisplay}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Accessibility</dt>
                <dd className="max-w-[60%] text-right text-slate-100">
                  {preparedPreferences.accessibilityNotes ?? "—"}
                </dd>
              </div>
            </dl>
            {hasPersonaExtras ? (
              <div className="mt-5 rounded-xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs text-slate-300">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
                  Persona context
                </h3>
                <dl className="mt-3 space-y-2">
                  {Object.entries(personaExtras).map(([key, value]) => {
                    const readableKey = key
                      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
                      .replace(/[-_]+/g, " ");

                    return (
                      <div key={key} className="flex justify-between gap-4">
                        <dt className="text-slate-500">
                          {toTitleCase(readableKey)}
                        </dt>
                        <dd className="max-w-[60%] text-right text-slate-100">
                          {value}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ) : null}
          </aside>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-xl font-semibold">Story preview</h2>
            {latestStory ? (
              <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-200">
                {latestStory}
              </p>
            ) : (
              <p className="mt-4 text-sm text-slate-400">
                Trigger a narration to preview the full script here.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-lg font-semibold">Narration log</h2>
            {narrationLog.length ? (
              <ul className="mt-4 space-y-3 text-xs text-slate-400">
                {narrationLog.map((entry) => (
                  <li
                    key={`${entry.poiId}-${entry.timestamp}`}
                    className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="font-medium text-slate-100">
                        {entry.poiName}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {formatTimestamp(entry.timestamp)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-slate-400">
                      {entry.story}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-xs text-slate-500">
                Narrations triggered here will appear in a running log.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold">
                Changi Jewel knowledge snapshot
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                {knowledge.overview.summary}
              </p>
              <ul className="mt-3 space-y-2 text-xs text-slate-400">
                {overviewBullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 px-4 py-3 text-xs text-slate-400">
              <span className="uppercase tracking-wide text-slate-500">
                Last verified
              </span>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {knowledge.overview.lastVerified}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                Refer to `src/data/changi-jewel/knowledge-base.ts` for full
                context and references.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {quickFactCards.map((fact) => (
              <article
                key={fact.label}
                className="flex flex-col gap-2 rounded-xl border border-slate-800/60 bg-slate-950/60 p-4"
              >
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  {fact.category}
                </div>
                <h3 className="text-sm font-semibold text-slate-100">
                  {fact.label}
                </h3>
                <p className="text-xs leading-6 text-slate-400">{fact.value}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                History highlights
              </h3>
              <ol className="mt-3 space-y-3 text-sm text-slate-300">
                {historyHighlights.map((event, index) => (
                  <li
                    key={`${event.title}-${index}`}
                    className="rounded-lg border border-slate-800/60 bg-slate-950/50 p-3"
                  >
                    <span className="text-xs uppercase tracking-wide text-emerald-300">
                      Phase {index + 1}
                    </span>
                    <p className="mt-1 font-medium text-slate-100">
                      {event.title}
                    </p>
                    <p className="mt-1 text-xs leading-6 text-slate-400">
                      {event.summary}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Frequent traveller questions
              </h3>
              <dl className="mt-3 space-y-3 text-sm text-slate-300">
                {featuredFaqs.map((faq) => (
                  <div
                    key={faq.question}
                    className="rounded-lg border border-slate-800/60 bg-slate-950/50 p-3"
                  >
                    <dt className="font-medium text-slate-100">
                      {faq.question}
                    </dt>
                    <dd className="mt-1 text-xs leading-6 text-slate-400">
                      {faq.answer}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-50">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-200">
            Assumptions & tips
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Narrations run entirely on demand—no passive tracking or
              background sensors required.
            </li>
            <li>
              You can plug in additional Changi Jewel experiences by exporting
              more data files and adding them to the `poiCatalog` list.
            </li>
            <li>
              `generateStorytellingForPlaceOfInterest` can be swapped with your
              favourite LLM for richer scripts; the current version is a
              rule-based template.
            </li>
            <li>
              `narrateToUser` will use the browser Speech Synthesis API when
              available, with a console fallback for development.
            </li>
          </ul>
        </section>
      </main>

      <footer className="border-t border-slate-800/60 bg-slate-950/80">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Storytelling is instant—feel free to improvise on the fly.
          </span>
          <div className="flex items-center gap-4">
            <a
              href="/admin"
              className="text-emerald-400 hover:text-emerald-300 transition-colors"
              title="View saved image analyses"
            >
              Admin Panel
            </a>
            <span>
              Built for the AI Tour Guide prototype · {new Date().getFullYear()}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
