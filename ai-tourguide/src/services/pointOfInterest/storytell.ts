"use server";

import OpenAI from "openai";

import {
  PlaceOfInterest,
  UserPreferences,
  prepareUserPreferences,
} from "@/lib/storytelling";

const DEFAULT_MODEL = process.env.OPENAI_TOUR_GUIDE_MODEL ?? "gpt-4.1-mini";
const DEFAULT_TEMPERATURE = Number.parseFloat(
  process.env.OPENAI_TOUR_GUIDE_TEMPERATURE ?? "0.7"
);

let cachedClient: OpenAI | null = null;

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatPersonaExtras(extras: Record<string, string>): string {
  return Object.entries(extras)
    .map(([key, value]) => {
      const readableKey = key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[-_]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");

      return `${toTitleCase(readableKey || key)}: ${value}`;
    })
    .join("\n");
}

function getClient(): OpenAI {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Add it to your environment to generate narrations with OpenAI."
    );
  }

  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

type NarrationRequest = {
  poi: PlaceOfInterest;
  preferences: UserPreferences;
  /**
   * Optional instruction override for experimentation.
   * Keep responses concise to maintain listener engagement.
   */
  extraGuidance?: string;
};

export async function narratePointOfInterestWithOpenAI({
  poi,
  preferences,
  extraGuidance,
}: NarrationRequest): Promise<string> {
  const client = getClient();
  const prepared = prepareUserPreferences(preferences);

  console.info("[OpenAI][Narration] starting", {
    poiId: poi.id,
    poiName: poi.name,
    traveller: prepared.travelerName,
    tone: prepared.preferredTone,
    pace: prepared.preferredPace,
    extraGuidance: Boolean(extraGuidance),
  });

  const toneDescriptor =
    prepared.preferredTone === "playful"
      ? "playful, energetic"
      : prepared.preferredTone === "elegant"
      ? "elegant, graceful"
      : "warm, inviting";

  const paceDescriptor =
    prepared.preferredPace === "leisurely"
      ? "at an easy-going pace"
      : prepared.preferredPace === "adventurous"
      ? "with dynamic momentum"
      : "with concise momentum";

  const interests = prepared.interests.join(", ");
  const companions = prepared.tripCompanions.join(", ");
  const highlights = poi.highlights.join("; ");
  const sensory = poi.sensoryDetails.join("; ");
  const insiderTips = poi.insiderTips?.join("; ") ?? "";

  const extraPersonaNotes = formatPersonaExtras(prepared.extras);
  const defaultGuidance =
    "Keep it super punchy (about 40 words). Drop playful Singlish beats — think “wah, so shiok”, “confirm can”, “steady lah” — while sharing one vivid detail linked to the traveller. End with a single short question that nudges their next move.";

  const userContent = `
POI: ${poi.name}
Summary: ${poi.summary}
Highlights: ${highlights}
Sensory cues: ${sensory}
Suggested duration: ${poi.suggestedDuration}
Insider tips: ${insiderTips || "None"}
Call to action cue: ${poi.callToAction ?? "Invite them to explore soon."}

Traveller name: ${prepared.travelerName}
Companions: ${companions || "Solo"}
Traveller interests: ${interests || "General exploration"}
Preferred tone (normalised): ${toneDescriptor}
Preferred pace (normalised): ${paceDescriptor}
Raw tone hint: ${
    typeof preferences.preferredTone === "string" &&
    preferences.preferredTone.trim()
      ? preferences.preferredTone.trim()
      : "Not specified"
  }
Raw pace hint: ${
    typeof preferences.preferredPace === "string" &&
    preferences.preferredPace.trim()
      ? preferences.preferredPace.trim()
      : "Not specified"
  }
Accessibility notes: ${prepared.accessibilityNotes ?? "None"}
Persona extras: ${extraPersonaNotes || "None"}

Additional guidance: ${extraGuidance ?? defaultGuidance}
`;

  let response;
  try {
    response = await client.responses.create({
      metadata: {
        source: "narratePointOfInterestWithOpenAI",
        poiId: poi.id,
      },
      model: DEFAULT_MODEL,
      temperature: Number.isNaN(DEFAULT_TEMPERATURE)
        ? 0.7
        : DEFAULT_TEMPERATURE,
      max_output_tokens: 400,
      input: [
        {
          role: "system",
          content:
            "You are a friendly personal tour guide, sound like a young woman in her early 20s — cheerful, confident, and slightly dramatic, with natural Singlish rhythm and tone. She speaks fast and animatedly, with casual English and Singlish inflection (like “lah”, “leh”, “lor”, “sia”, “pls”, “eh”) plus cheeky phrases such as “wah, damn shiok hor”, “steady lah”, “don’t blur blur, can?”. The overall mood: charismatic, witty, expressive — a young Singaporean girl who can go from “LOL that one so cringe” to “but honestly, it’s kinda true lah”, with good pause using fullstops and break into paragraphs. Structure every reply as: (1) a snappy overview of the place, (2) one personalised highlight that links to the traveller's interests or needs without repeating my input, (3) exactly one leading question that invites them to continue exploring. Aim for two lively sentences followed by the question. Keep the delivery breezy, stay respectful and accessible, and cap everything at 40 words.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    });
  } catch (error) {
    console.error("[OpenAI][Narration] failed", {
      poiId: poi.id,
      poiName: poi.name,
      error,
    });
    throw error;
  }

  console.info("[OpenAI][Narration] completed", {
    poiId: poi.id,
    poiName: poi.name,
    tokenUsage: response.usage,
    extraGuidance: Boolean(extraGuidance),
  });

  const narration = response.output_text?.trim();

  if (!narration) {
    throw new Error("OpenAI returned an empty narration response.");
  }

  return narration;
}
