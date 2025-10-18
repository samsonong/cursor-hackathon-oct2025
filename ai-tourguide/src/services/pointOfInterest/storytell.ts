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

  const userContent = `
Point of interest: ${poi.name}
Summary: ${poi.summary}
Highlights: ${highlights}
Sensory details: ${sensory}
Suggested duration: ${poi.suggestedDuration}
Insider tips: ${insiderTips}
Call to action: ${poi.callToAction ?? "Invite them to explore soon."}

Traveller name: ${prepared.travelerName}
Companions: ${companions || "Solo trip"}
Interests: ${interests || "General exploration"}
Preferred tone: ${toneDescriptor}
Preferred pace: ${paceDescriptor}
Accessibility notes: ${prepared.accessibilityNotes ?? "None provided"}
Original tone hint: ${
    typeof preferences.preferredTone === "string" &&
    preferences.preferredTone.trim()
      ? preferences.preferredTone.trim()
      : "Not specified"
  }
Original pace hint: ${
    typeof preferences.preferredPace === "string" &&
    preferences.preferredPace.trim()
      ? preferences.preferredPace.trim()
      : "Not specified"
  }
Additional guidance: ${
    extraGuidance ?? "Keep the narration vivid and human, 120-160 words."
  }
Additional persona context: ${
    extraPersonaNotes || "No extra persona context supplied"
  }
`;

  const response = await client.responses.create({
    model: DEFAULT_MODEL,
    temperature: Number.isNaN(DEFAULT_TEMPERATURE) ? 0.7 : DEFAULT_TEMPERATURE,
    max_output_tokens: 400,
    input: [
      {
        role: "system",
        content:
          "You are an on-location tour guide narrating Jewel Changi Airport experiences. Blend storytelling with practical cues. Speak directly to the traveller, stay positive, and weave in at least one highlight tied to their interests and accessibility needs.",
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const narration = response.output_text?.trim();

  if (!narration) {
    throw new Error("OpenAI returned an empty narration response.");
  }

  return narration;
}
