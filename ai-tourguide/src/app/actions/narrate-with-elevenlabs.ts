"use server";

import { narrateWithElevenLabs } from "@/services/voice/voice";

export type NarrateWithElevenLabsInput = {
  text: string;
  voiceId?: string;
};

export async function narrateWithElevenLabsAction({
  text,
  voiceId,
}: NarrateWithElevenLabsInput): Promise<string> {
  if (!text.trim()) {
    throw new Error("Cannot generate audio without narration text.");
  }

  const audioBuffer = await narrateWithElevenLabs({ text, voiceId });
  return `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
}
