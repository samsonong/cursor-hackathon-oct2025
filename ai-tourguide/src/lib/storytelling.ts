export type UserPreferences = {
  travelerName: string;
  tripCompanions: string[];
  interests: string[];
  preferredTone: "playful" | "warm" | "elegant";
  preferredPace: "leisurely" | "adventurous" | "express";
  accessibilityNotes?: string;
};

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
  const primaryInterest = pickFirstMatch(poi.highlights, preferences.interests);
  const highlightedMoment = primaryInterest ?? poi.highlights[0] ?? poi.summary;
  const tonePrefix =
    preferences.preferredTone === "playful"
      ? "Let me paint a vivid picture for you"
      : preferences.preferredTone === "elegant"
      ? "Allow me to share a refined glimpse"
      : "Here's what awaits you";

  const companionLine = preferences.tripCompanions.length
    ? `with ${preferences.tripCompanions.join(", ")}`
    : "solo";

  const paceLine =
    preferences.preferredPace === "leisurely"
      ? "Take your time to soak it all in"
      : preferences.preferredPace === "adventurous"
      ? "Let the energy carry you forward"
      : "We'll keep things brisk and delightful";

  const sensoryLine = poi.sensoryDetails.length
    ? `Picture ${poi.sensoryDetails.join(" and ")}.`
    : "You'll feel right at home the moment you arrive.";

  const accessibilityLine = preferences.accessibilityNotes
    ? `Keep in mind: ${preferences.accessibilityNotes}.`
    : "";

  const insiderLine = poi.insiderTips?.length
    ? `Local tip: ${poi.insiderTips[0]}.`
    : "";

  const actionLine = poi.callToAction
    ? poi.callToAction
    : `Shall we explore ${poi.name} now?`;

  return [
    `${tonePrefix}, ${preferences.travelerName} ${companionLine}!`,
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

export async function narrateToUser(narration: string): Promise<void> {
  if (typeof window === "undefined") {
    console.info("[Narration]", narration);
    return;
  }

  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(narration);

    await new Promise<void>((resolve) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });

    return;
  }

  console.info("[Narration]", narration);
}
