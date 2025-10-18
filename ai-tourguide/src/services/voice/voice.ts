"use server";

import { VOICE_CONFIG } from "./data";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// This is a default voice ID. You can replace it with your own.
const DEFAULT_VOICE_ID = VOICE_CONFIG["Cheryl Tan"].id;
const DEFAULT_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2";

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
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  speed?: number;
};

type VoiceOverrides = Pick<
  ElevenLabsNarrationRequest,
  "stability" | "similarityBoost" | "style" | "useSpeakerBoost" | "speed"
>;

function resolveVoiceSettings(voiceId: string, overrides: VoiceOverrides) {
  const voiceConfig = Object.values(VOICE_CONFIG).find(
    (voice) => voice.id === voiceId
  );

  return {
    stability: overrides.stability ?? voiceConfig?.settings.stability ?? 0.5,
    similarity_boost:
      overrides.similarityBoost ??
      voiceConfig?.settings.similarityBoost ??
      0.75,
    style: overrides.style ?? voiceConfig?.settings.style ?? 0.0,
    use_speaker_boost: overrides.useSpeakerBoost ?? true,
    speed: overrides.speed ?? voiceConfig?.settings.speed ?? 0.9,
  };
}

async function requestElevenLabsStream({
  text,
  voiceId = DEFAULT_VOICE_ID,
  modelId = DEFAULT_MODEL_ID,
  optimizeLatency = 4,
  stability,
  similarityBoost,
  style,
  useSpeakerBoost,
  speed,
}: ElevenLabsNarrationRequest) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error(
      "Missing ELEVENLABS_API_KEY. Cannot generate audio with ElevenLabs."
    );
  }

  const voiceSettings = resolveVoiceSettings(voiceId, {
    stability,
    similarityBoost,
    style,
    useSpeakerBoost,
    speed,
  });

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
        voice_settings: voiceSettings,
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

  return response;
}

/**
 * Generates audio from text using the ElevenLabs API.
 * @returns A Buffer containing the audio data.
 */
export async function narrateWithElevenLabs({
  text,
  voiceId = DEFAULT_VOICE_ID,
  modelId = DEFAULT_MODEL_ID,
  optimizeLatency = 4,
  stability,
  similarityBoost,
  style,
  useSpeakerBoost = true,
  speed,
}: ElevenLabsNarrationRequest): Promise<Buffer> {
  try {
    const response = await requestElevenLabsStream({
      text,
      voiceId,
      modelId,
      optimizeLatency,
      stability,
      similarityBoost,
      style,
      useSpeakerBoost,
      speed,
    });

    const stream = response.body;

    if (!stream) {
      throw new Error("ElevenLabs response did not include a stream body.");
    }

    const reader = stream.getReader();
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

export async function streamNarrationWithElevenLabs({
  text,
  voiceId = DEFAULT_VOICE_ID,
  modelId = DEFAULT_MODEL_ID,
  optimizeLatency = 4,
  stability,
  similarityBoost,
  style,
  useSpeakerBoost = true,
  speed,
}: ElevenLabsNarrationRequest): Promise<ReadableStream<Uint8Array>> {
  try {
    const response = await requestElevenLabsStream({
      text,
      voiceId,
      modelId,
      optimizeLatency,
      stability,
      similarityBoost,
      style,
      useSpeakerBoost,
      speed,
    });

    const stream = response.body;

    if (!stream) {
      throw new Error("ElevenLabs response did not include a stream body.");
    }

    return stream;
  } catch (error) {
    console.error("Failed to stream audio with ElevenLabs:", error);
    throw new Error(
      "Failed to stream audio. Please check the server logs for more details."
    );
  }
}
