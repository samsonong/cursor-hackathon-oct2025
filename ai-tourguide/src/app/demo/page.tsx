"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { narratePointOfInterestAction } from "@/app/actions/narrate-point-of-interest";
import { narrateWithElevenLabsAction } from "@/app/actions/narrate-with-elevenlabs";
import { answerUserQuestion } from "@/app/conversation/page";
import { userPreferences } from "@/data/user-preferences";
import { changiJewelMain, changiJewelRainVortex } from "@/data/changi-jewel";
import {
  PlaceOfInterest,
  generateStorytellingForPlaceOfInterest,
  narrateToUser,
} from "@/lib/storytelling";
import {
  type WakeWordDetectionResult,
  detectAndStripWakeWord,
  getWakeWord,
} from "@/lib/wake-word";
import { VOICE_CONFIG } from "@/services/voice/data";

const WAKE_WORD_SILENCE_MS = 2_000;
const WAVEFORM_SAMPLES = 48;
const FALLBACK_RECOGNITION_LANGS = ["en-SG", "en-US", "en-GB", "en-AU", "en"];
const NARRATION_POLL_INTERVAL_MS = 2_000;

const poiCatalog: PlaceOfInterest[] = [changiJewelMain, changiJewelRainVortex];

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

type DemoNarrationRequestPayload = {
  id: string;
  poiId: string;
  voiceId?: string;
};

async function playAudioFromDataUrl(dataUrl: string): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const audio = new Audio(dataUrl);

  await new Promise<void>((resolve, reject) => {
    const handleError = (event: Event) => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      reject(new Error(`Audio playback failed: ${event.type}`));
    };

    const handleEnded = () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      resolve();
    };

    audio.addEventListener("ended", handleEnded, { once: true });
    audio.addEventListener("error", handleError, { once: true });

    const playPromise = audio.play();

    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => {
        audio.pause();
        reject(error);
      });
    }
  });
}

export default function DemoSplashPage() {
  const activeWakeWord = useMemo(() => getWakeWord(), []);
  const defaultVoiceId = useMemo(
    () => Object.values(VOICE_CONFIG)[0]?.id ?? "",
    []
  );
  const [isMicListening, setIsMicListening] = useState<boolean>(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [isWakeWordActive, setIsWakeWordActive] = useState<boolean>(false);
  const [volumeLevel, setVolumeLevel] = useState<number>(0);
  const [waveformPoints, setWaveformPoints] = useState<number[]>(() =>
    new Array(WAVEFORM_SAMPLES).fill(0)
  );
  const [isNarrating, setIsNarrating] = useState<boolean>(false);
  const [currentPoi, setCurrentPoi] = useState<PlaceOfInterest>(poiCatalog[0]);
  const [activeVoiceId, setActiveVoiceId] = useState<string>(defaultVoiceId);
  const [conversationSessionId, setConversationSessionId] = useState<
    string | null
  >(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const lastSpeechAtRef = useRef<number | null>(null);
  const wakeWordActiveRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const wakeWordPausedRef = useRef<boolean>(false);
  const isHandlingWakeWordRef = useRef<boolean>(false);
  const conversationSessionIdRef = useRef<string | null>(null);
  const currentPoiRef = useRef<PlaceOfInterest>(poiCatalog[0]);
  const activeVoiceIdRef = useRef<string>(defaultVoiceId);
  const pollTimeoutRef = useRef<number | null>(null);
  const isProcessingNarrationRef = useRef<boolean>(false);
  const waveformGradientId = useId();

  useEffect(() => {
    currentPoiRef.current = currentPoi;
  }, [currentPoi]);

  useEffect(() => {
    activeVoiceIdRef.current = activeVoiceId || defaultVoiceId;
  }, [activeVoiceId, defaultVoiceId]);

  useEffect(() => {
    conversationSessionIdRef.current = conversationSessionId;
  }, [conversationSessionId]);

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
          console.warn(
            "Speech recognition error while listening to the user",
            event
          );
          setMicError(
            typeof event?.error === "string"
              ? `Speech recognition error: ${event.error}`
              : "Microphone listening error occurred."
          );
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
      wakeWordActiveRef.current = true;
      setIsWakeWordActive(true);
      setMicError(null);

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
          const agentResponse = await answerUserQuestion({
            sessionId: conversationSessionIdRef.current,
            text: rawText,
            strippedText,
            wakeWordDetected: wakeWordUsed,
            wakeWord: activeWakeWord,
            placeName: currentPoiRef.current?.name,
          });

          setMicError(null);

          if (agentResponse.ended) {
            setConversationSessionId(null);
          } else {
            setConversationSessionId(agentResponse.sessionId);
          }

          if (agentResponse.reply) {
            await narrateToUser(agentResponse.reply);
          }

          return agentResponse;
        };

        const capturedSpeech = await listenToUser(detection.stripped ?? "");
        const trimmedSpeech = capturedSpeech?.replace(/\s+/g, " ").trim();

        if (!trimmedSpeech) {
          return;
        }

        const rawQuestion = [detection.wakeWord, trimmedSpeech]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        const initialResponse = await callAgent(
          rawQuestion,
          trimmedSpeech,
          true
        );

        if (initialResponse.ended) {
          return;
        }

        while (true) {
          const followUpRaw = await listenToUser("");
          const followUp = followUpRaw?.replace(/\s+/g, " ").trim();

          if (!followUp) {
            break;
          }

          const followUpResponse = await callAgent(followUp, followUp, false);

          if (followUpResponse.ended) {
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
        wakeWordActiveRef.current = false;
        setIsWakeWordActive(false);

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
    [activeWakeWord, listenToUser]
  );

  const speakPointOfInterest = useCallback(
    async (poi: PlaceOfInterest | null, voiceOverride?: string) => {
      if (!poi) {
        console.warn("Narration request ignored: unknown point of interest");
        return;
      }

      if (isNarrating || isHandlingWakeWordRef.current) {
        return;
      }

      setCurrentPoi(poi);
      const voiceToUse = voiceOverride || activeVoiceIdRef.current;
      if (voiceOverride) {
        setActiveVoiceId(voiceOverride);
      }

      setIsNarrating(true);
      setMicError(null);

      const resumeWakeWordListening = () => {
        wakeWordPausedRef.current = false;
        wakeWordActiveRef.current = false;
        setIsWakeWordActive(false);

        if (recognitionRef.current) {
          try {
            recognitionRef.current.start();
            setIsMicListening(true);
          } catch (restartError) {
            console.warn(
              "Unable to restart wake word recognition after narration",
              restartError
            );
            setMicError(
              "Microphone listener stopped unexpectedly. Reload to retry."
            );
          }
        }
      };

      wakeWordPausedRef.current = true;
      wakeWordActiveRef.current = false;
      setIsWakeWordActive(false);

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (stopError) {
          console.warn(
            "Error stopping wake word recognition before narration",
            stopError
          );
        }
      }
      setIsMicListening(false);

      try {
        const story = await narratePointOfInterestAction({
          poi,
          preferences: userPreferences,
        });

        let audioPlayed = false;

        try {
          if (voiceToUse) {
            const audioDataUrl = await narrateWithElevenLabsAction({
              text: story,
              voiceId: voiceToUse,
            });

            await playAudioFromDataUrl(audioDataUrl);
            audioPlayed = true;
          }
        } catch (audioError) {
          console.error("ElevenLabs narration failed", audioError);
        }

        if (!audioPlayed) {
          await narrateToUser(story);
        }
      } catch (untypedError) {
        console.error("AI narration failed", untypedError);

        const fallbackStory = generateStorytellingForPlaceOfInterest(
          userPreferences,
          poi
        );

        let audioPlayed = false;

        try {
          if (voiceToUse) {
            const fallbackAudioDataUrl = await narrateWithElevenLabsAction({
              text: fallbackStory,
              voiceId: voiceToUse,
            });

            await playAudioFromDataUrl(fallbackAudioDataUrl);
            audioPlayed = true;
          }
        } catch (audioError) {
          console.error("ElevenLabs fallback narration failed", audioError);
        }

        if (!audioPlayed) {
          await narrateToUser(fallbackStory);
        }
      } finally {
        setIsNarrating(false);
        resumeWakeWordListening();
      }
    },
    [isNarrating]
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
        if (!navigator.mediaDevices?.getUserMedia) {
          setMicError(
            "Microphone access isn't supported in this browser. Try Chrome on desktop."
          );
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        mediaStreamRef.current = stream;

        const AudioContextCtor =
          window.AudioContext ||
          (
            window as unknown as {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;

        if (AudioContextCtor) {
          try {
            const audioContext = new AudioContextCtor();
            await audioContext.resume().catch(() => undefined);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.18;

            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            audioContextRef.current = audioContext;
            analyserRef.current = analyser;

            const dataArray = new Uint8Array(analyser.fftSize);

            const sampleVolume = () => {
              if (cancelled || !analyserRef.current) {
                return;
              }

              analyser.getByteTimeDomainData(dataArray);
              let sumSquares = 0;
              for (let i = 0; i < dataArray.length; i += 1) {
                const value = (dataArray[i] - 128) / 128;
                sumSquares += value * value;
              }

              const rms = Math.sqrt(sumSquares / dataArray.length);
              const normalized = Math.min(rms * 9, 1);
              const targetVolume = wakeWordActiveRef.current
                ? Math.max(normalized, 0.015)
                : 0;

              setVolumeLevel((prev) => {
                const next = prev * 0.3 + targetVolume * 0.7;
                return Math.abs(next - prev) > 0.001 ? next : prev;
              });

              const step = Math.max(
                1,
                Math.floor(dataArray.length / WAVEFORM_SAMPLES)
              );
              const waveformSamples = new Array(WAVEFORM_SAMPLES);
              for (let i = 0; i < WAVEFORM_SAMPLES; i += 1) {
                let sum = 0;
                let count = 0;
                const start = i * step;
                for (
                  let j = 0;
                  j < step && start + j < dataArray.length;
                  j += 1
                ) {
                  const sampleValue = (dataArray[start + j] - 128) / 128;
                  sum += sampleValue;
                  count += 1;
                }
                const average = count > 0 ? sum / count : 0;
                waveformSamples[i] = Math.max(-1, Math.min(average * 1.8, 1));
              }

              setWaveformPoints((prev) =>
                prev.map((prevValue, index) => {
                  const target = wakeWordActiveRef.current
                    ? waveformSamples[index] ?? 0
                    : 0;
                  return prevValue * 0.4 + target * 0.6;
                })
              );

              animationFrameRef.current =
                window.requestAnimationFrame(sampleVolume);
            };

            if (animationFrameRef.current) {
              window.cancelAnimationFrame(animationFrameRef.current);
            }
            sampleVolume();
          } catch (audioSetupError) {
            console.warn(
              "Unable to initialise audio analyser",
              audioSetupError
            );
            setVolumeLevel(0);
            try {
              audioContextRef.current?.close();
            } catch (closeError) {
              console.warn("Audio context close failed", closeError);
            }
            audioContextRef.current = null;
            analyserRef.current = null;
          }
        } else {
          console.warn(
            "AudioContext not supported; volume animation disabled."
          );
        }

        const recognition = new SpeechRecognitionCtor();
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
          const now = Date.now();

          if (detection.matched && !wakeWordActiveRef.current) {
            wakeWordActiveRef.current = true;
            setIsWakeWordActive(true);
            void handleWakeWordMatch(detection);
          }

          if (detection.matched || wakeWordActiveRef.current) {
            lastSpeechAtRef.current = now;
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
            wakeWordActiveRef.current = false;
            setIsWakeWordActive(false);
            setVolumeLevel(0);
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

        const languagePreferences: string[] =
          typeof navigator === "undefined"
            ? []
            : [
                ...(Array.isArray(navigator.languages)
                  ? navigator.languages.filter((lang): lang is string =>
                      Boolean(lang)
                    )
                  : []),
                navigator.language,
              ].filter((lang): lang is string => Boolean(lang));

        const languageCandidates = [
          ...new Set([...languagePreferences, ...FALLBACK_RECOGNITION_LANGS]),
        ];

        let recognitionStarted = false;
        let lastStartError: unknown;

        for (const language of languageCandidates) {
          try {
            recognition.lang = language;
            recognition.start();
            recognitionStarted = true;
            setMicError(null);
            setIsMicListening(true);
            break;
          } catch (startError) {
            lastStartError = startError;
            if (
              startError instanceof DOMException &&
              (startError.name === "NotSupportedError" ||
                startError.message?.toLowerCase().includes("not supported"))
            ) {
              continue;
            }

            throw startError;
          }
        }

        if (!recognitionStarted) {
          throw (
            lastStartError ?? new Error("Unable to start speech recognition")
          );
        }
      } catch (requestError) {
        if (!cancelled) {
          setMicError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to access microphone."
          );
          setIsMicListening(false);
          setVolumeLevel(0);
        }
      }
    };

    initialise();

    return () => {
      cancelled = true;
      setIsMicListening(false);
      wakeWordActiveRef.current = false;
      setIsWakeWordActive(false);
      setVolumeLevel(0);
      wakeWordPausedRef.current = false;
      isHandlingWakeWordRef.current = false;

      if (pollTimeoutRef.current !== null) {
        window.clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }

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

      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      if (audioContextRef.current) {
        const ctx = audioContextRef.current;
        ctx.close().catch(() => undefined);
      }
      audioContextRef.current = null;
      analyserRef.current = null;
    };
  }, [activeWakeWord, handleWakeWordMatch]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!wakeWordActiveRef.current) {
      return;
    }

    const interval = window.setInterval(() => {
      const lastSpeech = lastSpeechAtRef.current;
      if (!wakeWordActiveRef.current) {
        window.clearInterval(interval);
        return;
      }

      if (lastSpeech && Date.now() - lastSpeech > WAKE_WORD_SILENCE_MS) {
        wakeWordActiveRef.current = false;
        lastSpeechAtRef.current = null;
        setIsWakeWordActive(false);
      }
    }, 300);

    return () => {
      window.clearInterval(interval);
    };
  }, [isWakeWordActive]);

  useEffect(() => {
    if (!isWakeWordActive) {
      lastSpeechAtRef.current = null;
      setVolumeLevel(0);
      setWaveformPoints(new Array(WAVEFORM_SAMPLES).fill(0));
    }
  }, [isWakeWordActive]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled) {
        return;
      }

      if (
        wakeWordPausedRef.current ||
        isHandlingWakeWordRef.current ||
        isProcessingNarrationRef.current
      ) {
        scheduleNext();
        return;
      }

      try {
        const response = await fetch("/api/demo/narration", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Narration poll failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          next: DemoNarrationRequestPayload | null;
        };

        const nextRequest = payload?.next;

        if (!nextRequest) {
          scheduleNext();
          return;
        }

        const requestedPoi =
          poiCatalog.find((poi) => poi.id === nextRequest.poiId) ??
          poiCatalog[0];
        const voiceId = nextRequest.voiceId || activeVoiceIdRef.current;

        isProcessingNarrationRef.current = true;
        await speakPointOfInterest(requestedPoi, voiceId);
      } catch (error) {
        console.error("Unable to process queued narration request", error);
      } finally {
        isProcessingNarrationRef.current = false;
        scheduleNext();
      }
    };

    const scheduleNext = () => {
      if (cancelled) {
        return;
      }
      if (pollTimeoutRef.current !== null) {
        window.clearTimeout(pollTimeoutRef.current);
      }
      pollTimeoutRef.current = window.setTimeout(
        poll,
        NARRATION_POLL_INTERVAL_MS
      );
    };

    poll();

    return () => {
      cancelled = true;
      if (pollTimeoutRef.current !== null) {
        window.clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [speakPointOfInterest]);

  const rawIntensity = isWakeWordActive ? Math.max(volumeLevel - 0.02, 0) : 0;
  const pulseIntensity = Math.min(1, rawIntensity * 1.55);
  const haloScale = isWakeWordActive ? 0.92 + pulseIntensity * 0.95 : 0.9;
  const haloOpacity = isWakeWordActive
    ? Math.min(0.92, 0.2 + pulseIntensity * 0.42)
    : 0.08;
  const ringScale = isWakeWordActive ? 1 + pulseIntensity * 0.28 : 1;
  const ringShadow = isWakeWordActive
    ? `0 0 0 ${12 + pulseIntensity * 29}px rgba(16, 185, 129, ${
        0.05 + pulseIntensity * 0.32
      })`
    : undefined;
  const badgeScale = isWakeWordActive ? 1 + pulseIntensity * 0.1 : 1;
  const waveformOpacity = isWakeWordActive
    ? Math.min(0.85, 0.22 + pulseIntensity * 0.55)
    : 0.12;
  const waveformStrokeWidth = 1 + pulseIntensity * 1.7;
  const waveformScale = isWakeWordActive ? 0.88 + pulseIntensity * 0.1 : 0.88;

  const waveformPath = useMemo(() => {
    if (!waveformPoints.length) {
      return "";
    }

    const segmentCount = Math.max(1, waveformPoints.length - 1);

    return waveformPoints
      .map((value, index) => {
        const x = (index / segmentCount) * 120;
        const y = 60 - value * 28;
        const command = index === 0 ? "M" : "L";
        return `${command} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }, [waveformPoints]);

  const statusLabel = micError
    ? "Waiting"
    : isWakeWordActive
    ? "Listening"
    : "Waiting";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-slate-950 px-6 text-center text-slate-100">
      <div className="space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">
          Currently exploring
          <span className="text-emerald-100">Changi Jewel</span>
        </span>
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Jewel Changi holds the stage
        </h1>
        <p className="text-sm leading-6 text-slate-400 sm:text-base">
          Let guests say the wake phrase to bring the storyteller to life.
        </p>
      </div>

      <div className="flex flex-col items-center gap-6">
        <div className="relative flex h-48 w-48 items-center justify-center sm:h-56 sm:w-56">
          <span
            className="absolute inset-0 rounded-full bg-emerald-400/20 transition-all duration-150 ease-out"
            style={{
              transform: `scale(${haloScale})`,
              opacity: haloOpacity,
            }}
            aria-hidden="true"
          />
          <span
            className={`absolute inset-6 rounded-full border transition-all duration-150 ease-out sm:inset-8 ${
              isWakeWordActive ? "border-emerald-400/80" : "border-slate-800"
            }`}
            style={{
              transform: `scale(${ringScale})`,
              boxShadow: ringShadow,
            }}
            aria-hidden="true"
          />
          <svg
            className="pointer-events-none absolute inset-8 h-auto w-auto sm:inset-10"
            viewBox="0 0 120 120"
            preserveAspectRatio="none"
            aria-hidden="true"
            style={{
              opacity: waveformOpacity,
              transform: `scale(${waveformScale})`,
            }}
          >
            <defs>
              <linearGradient
                id={waveformGradientId}
                x1="0%"
                x2="100%"
                y1="50%"
                y2="50%"
              >
                <stop offset="0%" stopColor="rgba(16, 185, 129, 0.1)" />
                <stop offset="50%" stopColor="rgba(52, 211, 153, 0.85)" />
                <stop offset="100%" stopColor="rgba(16, 185, 129, 0.1)" />
              </linearGradient>
            </defs>
            <path
              d={waveformPath || "M 0 60 L 120 60"}
              fill="none"
              stroke={`url(#${waveformGradientId})`}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={waveformStrokeWidth}
            />
          </svg>
          <span
            className={`relative z-10 flex h-16 w-16 items-center justify-center rounded-full text-[11px] font-semibold uppercase tracking-[0.28em] transition-transform duration-150 ease-out sm:h-18 sm:w-18 ${
              micError
                ? "bg-rose-500 text-rose-950"
                : isWakeWordActive
                ? "bg-emerald-400 text-emerald-950"
                : isMicListening
                ? "bg-slate-800 text-slate-200"
                : "bg-slate-900 text-slate-500"
            }`}
            style={{
              transform: `scale(${badgeScale})`,
            }}
          >
            {statusLabel}
          </span>
        </div>

        {micError ? (
          <p className="max-w-md text-sm text-rose-300">{micError}</p>
        ) : (
          <div className="space-y-2 text-sm text-slate-300">
            <p>
              Say
              <span className="mx-1 rounded-sm bg-slate-900 px-1.5 py-0.5 font-semibold text-slate-100">
                “{activeWakeWord}”
              </span>
              to wake the guide.
            </p>
            <p className="text-xs text-slate-500">
              The glow and waveform surge while we hear you and ease off when
              you pause.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
