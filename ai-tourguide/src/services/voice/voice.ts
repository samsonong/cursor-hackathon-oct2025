"use server";

import { VOICE_CONFIG } from "./data";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// This is a default voice ID. You can replace it with your own.
const DEFAULT_VOICE_ID = VOICE_CONFIG["Cheryl Tan"];

if (!ELEVENLABS_API_KEY) {
  console.warn(
    "Missing ELEVENLABS_API_KEY. Add it to your environment to generate audio with ElevenLabs."
  );
}

type ElevenLabsNarrationRequest = {
  text: string;
  voiceId?: string;
};

/**
 * Generates audio from text using the ElevenLabs API.
 * @returns A Buffer containing the audio data.
 */
export async function narrateWithElevenLabs({
  text,
  voiceId = DEFAULT_VOICE_ID,
}: ElevenLabsNarrationRequest): Promise<Buffer> {
  if (!ELEVENLABS_API_KEY) {
    // In a real app, you might want to return a pre-recorded message
    // or handle this more gracefully than throwing an error.
    throw new Error(
      "Missing ELEVENLABS_API_KEY. Cannot generate audio with ElevenLabs."
    );
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `ElevenLabs API error: ${response.statusText} - ${errorBody}`
      );
    }

    const audioArrayBuffer = await response.arrayBuffer();
    return Buffer.from(audioArrayBuffer);
  } catch (error) {
    console.error("Failed to generate audio with ElevenLabs:", error);
    throw new Error(
      "Failed to generate audio. Please check the server logs for more details."
    );
  }
}
