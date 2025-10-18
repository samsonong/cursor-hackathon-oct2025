"use server";

import type { PlaceOfInterest, UserPreferences } from "@/lib/storytelling";
import { narratePointOfInterestWithOpenAI } from "@/services/pointOfInterest/storytell";

export type NarratePointOfInterestInput = {
  poi: PlaceOfInterest;
  preferences: UserPreferences;
  extraGuidance?: string;
};

export async function narratePointOfInterestAction({
  poi,
  preferences,
  extraGuidance,
}: NarratePointOfInterestInput): Promise<string> {
  return narratePointOfInterestWithOpenAI({
    poi,
    preferences,
    extraGuidance,
  });
}
