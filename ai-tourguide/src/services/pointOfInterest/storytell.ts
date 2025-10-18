"use server";

import OpenAI from "openai";

import { PlaceOfInterest, UserPreferences } from "@/lib/storytelling";

const DEFAULT_MODEL = process.env.OPENAI_TOUR_GUIDE_MODEL ?? "gpt-4.1-mini";
const DEFAULT_TEMPERATURE = Number.parseFloat(
  process.env.OPENAI_TOUR_GUIDE_TEMPERATURE ?? "0.7"
);

let cachedClient: OpenAI | null = null;

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

  const toneDescriptor =
    preferences.preferredTone === "playful"
      ? "playful, energetic"
      : preferences.preferredTone === "elegant"
      ? "elegant, graceful"
      : "warm, inviting";

  const paceDescriptor =
    preferences.preferredPace === "leisurely"
      ? "at an easy-going pace"
      : preferences.preferredPace === "adventurous"
      ? "with dynamic momentum"
      : "with concise momentum";

  const interests = preferences.interests.join(", ");
  const companions = preferences.tripCompanions.join(", ");
  const highlights = poi.highlights.join("; ");
  const sensory = poi.sensoryDetails.join("; ");
  const insiderTips = poi.insiderTips?.join("; ") ?? "";

  const userContent = `
Point of interest: ${poi.name}
Summary: ${poi.summary}
Highlights: ${highlights}
Sensory details: ${sensory}
Suggested duration: ${poi.suggestedDuration}
Insider tips: ${insiderTips}
Call to action: ${poi.callToAction ?? "Invite them to explore soon."}

Traveller name: ${preferences.travelerName}
Companions: ${companions || "Solo trip"}
Interests: ${interests || "General exploration"}
Preferred tone: ${toneDescriptor}
Preferred pace: ${paceDescriptor}
Accessibility notes: ${preferences.accessibilityNotes ?? "None provided"}
Additional guidance: ${
    extraGuidance ?? "Keep the narration vivid and human, 120-160 words."
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
