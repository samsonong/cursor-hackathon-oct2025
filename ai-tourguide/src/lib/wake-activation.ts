import { narrateToUser } from "./storytelling";
import {
  DEFAULT_WAKE_WORD,
  detectAndStripWakeWord,
  getWakeWord,
} from "./wake-word";

export type WakeWordActivationOptions = {
  locale?: string;
  placeName?: string;
  wakeWord?: string;
  sessionId?: string | null;
  conversationEndpoint?: string;
  fetchInit?: Omit<RequestInit, "method" | "body"> & {
    headers?: Record<string, string>;
  };
  onPartialTranscript?: (transcript: string) => void;
  onListeningStart?: () => void;
  onListeningEnd?: (transcript: string) => void;
  /** Called right before the request to the tour guide API is sent. */
  onWaitingForReplyStart?: () => void;
  /** Called after the request resolves (success or failure) with the reply content when available. */
  onWaitingForReplyEnd?: (reply: string | null) => void;
  onReplyReady?: (reply: string) => void;
  signal?: AbortSignal;
};

export type WakeWordActivationResult = {
  transcript: string;
  strippedTranscript: string;
  reply: string | null;
  sessionId: string | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
  confidence?: number;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
  message?: string;
};

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

type ListenForSpeechOptions = {
  locale?: string;
  maxDurationMs?: number;
  onPartialTranscript?: (transcript: string) => void;
  onListeningStart?: () => void;
  onListeningEnd?: (transcript: string) => void;
  signal?: AbortSignal;
};

type ListenForSpeechResult = {
  transcript: string;
};

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const speechWindow = window as SpeechRecognitionWindow;
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  );
}

async function listenForSpeechOnce(
  options: ListenForSpeechOptions = {}
): Promise<ListenForSpeechResult> {
  const ctor = getSpeechRecognitionCtor();

  if (!ctor) {
    throw new Error("Speech recognition API is not available in this browser.");
  }

  if (typeof window === "undefined") {
    throw new Error("Speech capture requires a browser environment.");
  }

  const {
    locale = "en-SG",
    maxDurationMs = 15000,
    onPartialTranscript,
    onListeningStart,
    onListeningEnd,
    signal,
  } = options;

  const recognition = new ctor();
  recognition.lang = locale;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  return new Promise<ListenForSpeechResult>((resolve, reject) => {
    let finalTranscript = "";
    let partialTranscript = "";
    let settled = false;
    let timeoutId: number | null = null;

    const onAbort = () => {
      recognition.abort();
      fail(new Error("Speech capture aborted."));
    };

    const teardown = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const cleanup = () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    };

    const finish = (transcript: string) => {
      if (settled) {
        return;
      }
      settled = true;
      teardown();
      cleanup();
      if (typeof onListeningEnd === "function") {
        onListeningEnd(transcript);
      }
      resolve({ transcript });
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      teardown();
      cleanup();
      reject(error);
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    recognition.onstart = () => {
      if (typeof onListeningStart === "function") {
        onListeningStart();
      }
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let latestPartial = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alternative = result?.[0];
        if (!alternative) {
          continue;
        }

        if (result.isFinal) {
          finalTranscript =
            `${finalTranscript} ${alternative.transcript}`.trim();
        } else {
          latestPartial = `${latestPartial} ${alternative.transcript}`.trim();
        }
      }

      partialTranscript = latestPartial;

      if (latestPartial && typeof onPartialTranscript === "function") {
        onPartialTranscript(latestPartial);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      const message =
        typeof event?.error === "string"
          ? event.error
          : event?.message ?? "Speech recognition error.";
      fail(new Error(message));
    };

    recognition.onend = () => {
      const transcript = (finalTranscript || partialTranscript).trim();
      finish(transcript);
    };

    timeoutId = window.setTimeout(() => {
      recognition.stop();
    }, Math.max(1000, maxDurationMs));

    try {
      recognition.start();
    } catch (error) {
      fail(
        error instanceof Error
          ? error
          : new Error("Unable to start speech recognition.")
      );
    }
  });
}

export async function handleWakeWordActivation(
  options: WakeWordActivationOptions = {}
): Promise<WakeWordActivationResult> {
  if (typeof window === "undefined") {
    throw new Error("Wake word activation requires a browser environment.");
  }

  const {
    locale = "en-SG",
    placeName = "Jewel Changi Airport",
    wakeWord = getWakeWord(),
    sessionId = null,
    conversationEndpoint = "/api/conversation",
    fetchInit,
    onPartialTranscript,
    onListeningStart,
    onListeningEnd,
    onWaitingForReplyStart,
    onWaitingForReplyEnd,
    onReplyReady,
    signal,
  } = options;

  const { transcript } = await listenForSpeechOnce({
    locale,
    onPartialTranscript,
    onListeningStart,
    onListeningEnd,
    signal,
  });

  const trimmed = transcript.trim();

  if (!trimmed) {
    return {
      transcript: "",
      strippedTranscript: "",
      reply: null,
      sessionId,
    };
  }

  const detection = detectAndStripWakeWord(
    trimmed,
    wakeWord ?? DEFAULT_WAKE_WORD
  );

  const { headers: customHeaders, ...restFetchInit } = fetchInit ?? {};

  let response: Response;
  try {
    if (typeof onWaitingForReplyStart === "function") {
      onWaitingForReplyStart();
    }
    response = await fetch(conversationEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(customHeaders ?? {}),
      },
      body: JSON.stringify({
        sessionId,
        text: trimmed,
        strippedText: detection.stripped,
        wakeWordDetected: true,
        wakeWord: wakeWord ?? DEFAULT_WAKE_WORD,
        placeName,
      }),
      ...restFetchInit,
    });
  } catch (error) {
    if (typeof onWaitingForReplyEnd === "function") {
      onWaitingForReplyEnd(null);
    }
    throw new Error(
      error instanceof Error
        ? `Failed to reach the tour guide: ${error.message}`
        : "Failed to reach the tour guide."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (typeof onWaitingForReplyEnd === "function") {
      onWaitingForReplyEnd(null);
    }
    const message =
      typeof data?.error === "string" && data.error.trim()
        ? data.error
        : "Failed to reach the tour guide.";
    throw new Error(message);
  }

  const reply = typeof data?.reply === "string" ? data.reply : "";
  const nextSessionId = data?.sessionId ? String(data.sessionId) : sessionId;

  if (typeof onWaitingForReplyEnd === "function") {
    onWaitingForReplyEnd(reply || null);
  }

  if (reply && typeof onReplyReady === "function") {
    onReplyReady(reply);
  }

  if (reply) {
    await narrateToUser(reply);
  }

  return {
    transcript: trimmed,
    strippedTranscript: detection.stripped,
    reply: reply || null,
    sessionId: nextSessionId ?? null,
  };
}
