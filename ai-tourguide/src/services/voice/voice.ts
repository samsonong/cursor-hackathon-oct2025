"use server";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { resolve } from "path";

import { VOICE_CONFIG } from "./data";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE_ID = VOICE_CONFIG["Cheryl Tan"].id;
const DEFAULT_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2";

const VOICE_ALIAS_MAP: Record<string, string> = {
  "default-tour-guide": DEFAULT_VOICE_ID,
  default: DEFAULT_VOICE_ID,
};

const AUDIO_OUTPUT_DIR = resolve(process.cwd(), "data/generated-audio");
let audioDirReady: Promise<void> | null = null;

async function ensureAudioOutputDir(): Promise<void> {
  if (!audioDirReady) {
    audioDirReady = fs
      .mkdir(AUDIO_OUTPUT_DIR, { recursive: true })
      .then(() => undefined);
  }

  try {
    await audioDirReady;
  } catch (error) {
    audioDirReady = null;
    throw error;
  }
}

function buildAudioFilePath(voiceId: string): string {
  const safeVoice = voiceId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const baseName = safeVoice.length ? safeVoice : "narration";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${baseName}-${timestamp}-${randomUUID()}.mp3`;
  return resolve(AUDIO_OUTPUT_DIR, fileName);
}

async function streamToBuffer(
  stream: ReadableStream<Uint8Array>
): Promise<Buffer> {
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

  if (chunks.length === 0) {
    return Buffer.alloc(0);
  }

  if (chunks.length === 1) {
    return Buffer.from(chunks[0]);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const buffer = Buffer.allocUnsafe(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return buffer;
}

async function saveBufferToFile(
  buffer: Buffer,
  voiceId: string
): Promise<string | null> {
  if (!buffer?.length) {
    return null;
  }

  try {
    await ensureAudioOutputDir();
    const filePath = buildAudioFilePath(voiceId);
    await fs.writeFile(filePath, buffer);
    console.info("[ElevenLabs] Saved narration to", filePath);
    return filePath;
  } catch (error) {
    console.warn("[ElevenLabs] Failed to persist narration audio", error);
    return null;
  }
}

async function saveStreamToFile(
  stream: ReadableStream<Uint8Array>,
  voiceId: string
): Promise<string | null> {
  try {
    const buffer = await streamToBuffer(stream);
    return await saveBufferToFile(buffer, voiceId);
  } catch (error) {
    console.warn("[ElevenLabs] Failed to capture streaming narration", error);
    return null;
  }
}

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

function normaliseVoiceId(voiceId?: string): string {
  const fallback = DEFAULT_VOICE_ID;

  if (!voiceId) {
    return fallback;
  }

  const trimmed = voiceId.trim();
  if (!trimmed) {
    return fallback;
  }

  const lookupKey = trimmed.toLowerCase();

  if (VOICE_ALIAS_MAP[lookupKey]) {
    return VOICE_ALIAS_MAP[lookupKey];
  }

  const exactId = Object.values(VOICE_CONFIG).find((voice) => {
    return voice.id === trimmed;
  });

  if (exactId) {
    return exactId.id;
  }

  const byName = Object.entries(VOICE_CONFIG).find(([name]) => {
    return name.toLowerCase() === lookupKey;
  });

  if (byName) {
    return byName[1].id;
  }

  console.warn(
    `[ElevenLabs] Unknown voiceId "${voiceId}" provided. Falling back to default voice.`
  );
  return fallback;
}

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
}: ElevenLabsNarrationRequest): Promise<{
  response: Response;
  resolvedVoiceId: string;
}> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error(
      "Missing ELEVENLABS_API_KEY. Cannot generate audio with ElevenLabs."
    );
  }

  const resolvedVoiceId = normaliseVoiceId(voiceId);
  const voiceSettings = resolveVoiceSettings(resolvedVoiceId, {
    stability,
    similarityBoost,
    style,
    useSpeakerBoost,
    speed,
  });

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/stream`,
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

  return { response, resolvedVoiceId };
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
    const { response, resolvedVoiceId } = await requestElevenLabsStream({
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
    const buffer = await streamToBuffer(stream);
    const savedFilePath = await saveBufferToFile(buffer, resolvedVoiceId);

    if (savedFilePath) {
      (buffer as Buffer & { savedFilePath?: string }).savedFilePath =
        savedFilePath;
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
    const { response, resolvedVoiceId } = await requestElevenLabsStream({
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

    const [clientStream, fileStream] = stream.tee();

    void saveStreamToFile(fileStream, resolvedVoiceId).catch(
      (error: unknown) => {
        console.warn(
          "[ElevenLabs] Unable to persist streaming narration to file",
          error
        );
      }
    );

    return clientStream;
  } catch (error) {
    console.error("Failed to stream audio with ElevenLabs:", error);
    throw new Error(
      "Failed to stream audio. Please check the server logs for more details."
    );
  }
}
