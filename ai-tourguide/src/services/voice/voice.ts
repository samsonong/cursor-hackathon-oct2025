"use server";

import { VOICE_CONFIG } from "./data";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// This is a default voice ID. You can replace it with your own.
const DEFAULT_VOICE_ID = VOICE_CONFIG["Cheryl Tan"];
const DEFAULT_MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2";

if (!ELEVENLABS_API_KEY) {
  console.warn(
    "Missing ELEVENLABS_API_KEY. Add it to your environment to generate audio with ElevenLabs."
  );
}

type ElevenLabsNarrationRequest = {
  text: string;
  voiceId?: string;
  modelId?: string;
  optimizeLatency?: 0 | 1 | 2 | 3 | 4;
};

/**
 * Generates audio from text using the ElevenLabs API.
 * @returns A Buffer containing the audio data.
 */
export async function narrateWithElevenLabs({
  text,
  voiceId = DEFAULT_VOICE_ID,
  modelId = DEFAULT_MODEL_ID,
  optimizeLatency = 4,
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
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          optimize_streaming_latency: optimizeLatency,
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

    if (!response.body) {
      throw new Error("ElevenLabs response did not include a stream body.");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        chunks.push(value);
      }
    }

    const totalLength = chunks.reduce(
      (sum, chunk) => sum + chunk.byteLength,
      0
    );
    const buffer = Buffer.allocUnsafe(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return buffer;
  } catch (error) {
    console.error("Failed to generate audio with ElevenLabs:", error);
    throw new Error(
      "Failed to generate audio. Please check the server logs for more details."
    );
  }
}
