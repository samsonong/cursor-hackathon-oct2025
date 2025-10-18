export type UserPreferences = {
  travelerName?: string;
  tripCompanions?: string[] | string;
  interests?: string[] | string;
  preferredTone?: string;
  preferredPace?: string;
  accessibilityNotes?: string;
  [key: string]: unknown;
};

export type NormalizedUserPreferences = {
  travelerName: string;
  tripCompanions: string[];
  interests: string[];
  preferredTone: "playful" | "warm" | "elegant";
  preferredPace: "leisurely" | "adventurous" | "express";
  accessibilityNotes?: string;
};

export type PreparedUserPreferences = NormalizedUserPreferences & {
  raw: UserPreferences;
  extras: Record<string, string>;
};

const toneSynonyms: Record<
  NormalizedUserPreferences["preferredTone"],
  string[]
> = {
  playful: ["playful", "fun", "energetic", "lively", "witty", "cheerful"],
  warm: ["warm", "friendly", "caring", "comforting", "welcoming", "kind"],
  elegant: [
    "elegant",
    "refined",
    "luxurious",
    "sophisticated",
    "graceful",
    "polished",
  ],
};

const paceSynonyms: Record<
  NormalizedUserPreferences["preferredPace"],
  string[]
> = {
  leisurely: ["leisurely", "relaxed", "unhurried", "gentle", "easy"],
  adventurous: ["adventurous", "dynamic", "energised", "exploratory", "bold"],
  express: ["express", "brisk", "efficient", "fast", "purposeful"],
};

const knownPreferenceKeys = new Set(
  Object.keys({
    travelerName: true,
    tripCompanions: true,
    interests: true,
    preferredTone: true,
    preferredPace: true,
    accessibilityNotes: true,
  })
);

function normaliseName(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "Explorer";
}

function normaliseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,|]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function normaliseTone(
  value: string | undefined
): NormalizedUserPreferences["preferredTone"] {
  if (!value) {
    return "warm";
  }

  const lookup = value.trim().toLowerCase();

  for (const [tone, options] of Object.entries(toneSynonyms)) {
    if (options.includes(lookup)) {
      return tone as NormalizedUserPreferences["preferredTone"];
    }
  }

  return ["playful", "warm", "elegant"].includes(lookup)
    ? (lookup as NormalizedUserPreferences["preferredTone"])
    : "warm";
}

function normalisePace(
  value: string | undefined
): NormalizedUserPreferences["preferredPace"] {
  if (!value) {
    return "leisurely";
  }

  const lookup = value.trim().toLowerCase();

  for (const [pace, options] of Object.entries(paceSynonyms)) {
    if (options.includes(lookup)) {
      return pace as NormalizedUserPreferences["preferredPace"];
    }
  }

  return ["leisurely", "adventurous", "express"].includes(lookup)
    ? (lookup as NormalizedUserPreferences["preferredPace"])
    : "leisurely";
}

function normaliseAccessibilityNotes(value: unknown): string | undefined {
  if (typeof value === "string") {
    const cleaned = value.trim();
    return cleaned.length ? cleaned : undefined;
  }

  return undefined;
}

function formatPreferenceExtras(
  extras: Record<string, unknown>
): Record<string, string> {
  const formatted: Record<string, string> = {};

  for (const [key, value] of Object.entries(extras)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      formatted[key] = trimmed;
      continue;
    }

    if (Array.isArray(value)) {
      const filtered = value
        .map((entry) =>
          typeof entry === "string"
            ? entry.trim()
            : entry !== null && entry !== undefined
            ? String(entry)
            : ""
        )
        .filter(Boolean);

      if (!filtered.length) {
        continue;
      }

      formatted[key] = filtered.join(", ");
      continue;
    }

    if (typeof value === "object") {
      formatted[key] = JSON.stringify(value);
      continue;
    }

    formatted[key] = String(value);
  }

  return formatted;
}

export function prepareUserPreferences(
  preferences: UserPreferences
): PreparedUserPreferences {
  const raw = preferences ?? {};
  const {
    travelerName,
    tripCompanions,
    interests,
    preferredTone,
    preferredPace,
    accessibilityNotes,
    ...rest
  } = raw;

  const extras: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rest)) {
    if (!knownPreferenceKeys.has(key)) {
      extras[key] = value;
    }
  }

  const preparedExtras = formatPreferenceExtras(extras);

  return {
    travelerName: normaliseName(travelerName),
    tripCompanions: normaliseStringArray(tripCompanions),
    interests: normaliseStringArray(interests),
    preferredTone: normaliseTone(preferredTone),
    preferredPace: normalisePace(preferredPace),
    accessibilityNotes: normaliseAccessibilityNotes(accessibilityNotes),
    extras: preparedExtras,
    raw,
  };
}

export type PlaceOfInterest = {
  id: string;
  name: string;
  summary: string;
  highlights: string[];
  sensoryDetails: string[];
  suggestedDuration: string;
  insiderTips?: string[];
  callToAction?: string;
};

function pickFirstMatch(
  list: string[],
  interests: string[]
): string | undefined {
  return interests.find((interest) =>
    list.some((item) => item.toLowerCase().includes(interest.toLowerCase()))
  );
}

export function generateStorytellingForPlaceOfInterest(
  preferences: UserPreferences,
  poi: PlaceOfInterest
): string {
  const prepared = prepareUserPreferences(preferences);
  const {
    travelerName,
    tripCompanions,
    interests,
    preferredTone,
    preferredPace,
    accessibilityNotes,
  } = prepared;

  const primaryInterest = pickFirstMatch(poi.highlights, interests);
  const highlightedMoment = primaryInterest ?? poi.highlights[0] ?? poi.summary;
  const tonePrefix =
    preferredTone === "playful"
      ? "Let me paint a vivid picture for you"
      : preferredTone === "elegant"
      ? "Allow me to share a refined glimpse"
      : "Here's what awaits you";

  const companionLine = tripCompanions.length
    ? `with ${tripCompanions.join(", ")}`
    : "solo";

  const paceLine =
    preferredPace === "leisurely"
      ? "Take your time to soak it all in"
      : preferredPace === "adventurous"
      ? "Let the energy carry you forward"
      : "We'll keep things brisk and delightful";

  const sensoryLine = poi.sensoryDetails.length
    ? `Picture ${poi.sensoryDetails.join(" and ")}.`
    : "You'll feel right at home the moment you arrive.";

  const accessibilityLine = accessibilityNotes
    ? `Keep in mind: ${accessibilityNotes}.`
    : "";

  const insiderLine = poi.insiderTips?.length
    ? `Local tip: ${poi.insiderTips[0]}.`
    : "";

  const actionLine = poi.callToAction
    ? poi.callToAction
    : `Shall we explore ${poi.name} now?`;

  return [
    `${tonePrefix}, ${travelerName} ${companionLine}!`,
    poi.summary,
    `Highlight: ${highlightedMoment}.`,
    sensoryLine,
    `Plan for about ${poi.suggestedDuration}. ${paceLine}.`,
    insiderLine,
    accessibilityLine,
    actionLine,
  ]
    .filter(Boolean)
    .join(" ");
}

type NarrationOptions = {
  voiceId?: string;
  optimizeLatency?: 0 | 1 | 2 | 3 | 4;
  preferSpeechSynthesis?: boolean;
};

const STREAM_QUERY_LIMIT = 1400;
let activeNarrationAudio: HTMLAudioElement | null = null;

function stopActiveNarrationAudio() {
  if (!activeNarrationAudio) {
    return;
  }

  try {
    activeNarrationAudio.pause();
    activeNarrationAudio.src = "";
    activeNarrationAudio.load();
  } catch (error) {
    console.warn("Failed to stop previous narration audio", error);
  } finally {
    activeNarrationAudio = null;
  }
}

async function streamNarrationToAudioElement(
  narration: string,
  options: NarrationOptions
): Promise<void> {
  if (!("Audio" in window)) {
    throw new Error("Audio element not supported in this environment");
  }

  if (narration.length > STREAM_QUERY_LIMIT) {
    throw new Error("Narration too long to stream via query parameter");
  }

  const params = new URLSearchParams();
  params.set("text", narration);
  if (options.voiceId) {
    params.set("voiceId", options.voiceId);
  }
  if (options.optimizeLatency !== undefined) {
    params.set("optimizeLatency", String(options.optimizeLatency));
  }
  params.set("ts", Date.now().toString());

  stopActiveNarrationAudio();

  const audio = new Audio(`/api/narration?${params.toString()}`);
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      if (activeNarrationAudio === audio) {
        activeNarrationAudio = null;
      }
    };

    const handleEnded = () => {
      cleanup();
      resolve();
    };

    const handleError = (event: Event) => {
      audio.pause();
      cleanup();
      if (event instanceof ErrorEvent && event.message) {
        reject(new Error(event.message));
        return;
      }
      reject(new Error(`Audio stream error: ${event.type}`));
    };

    audio.addEventListener("ended", handleEnded, { once: true });
    audio.addEventListener("error", handleError, { once: true });

    activeNarrationAudio = audio;

    const playPromise = audio.play();

    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch((error) => {
        cleanup();
        reject(error);
      });
    }
  });
}

export async function narrateToUser(
  narration: string,
  options?: NarrationOptions
): Promise<void> {
  const trimmed = narration?.trim();

  if (!trimmed) {
    return;
  }

  if (typeof window === "undefined") {
    console.info("[Narration]", trimmed);
    return;
  }

  const narrationOptions = options ?? {};

  if (!narrationOptions.preferSpeechSynthesis) {
    try {
      await streamNarrationToAudioElement(trimmed, narrationOptions);
      return;
    } catch (error) {
      console.warn(
        "Streaming narration failed; falling back to speech synthesis",
        error
      );
    }
  }

  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (error) {
      console.warn("Unable to cancel existing speech synthesis", error);
    }

    const utterance = new SpeechSynthesisUtterance(trimmed);

    await new Promise<void>((resolve) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });

    return;
  }

  console.info("[Narration]", trimmed);
}
