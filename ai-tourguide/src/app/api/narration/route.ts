import { streamNarrationWithElevenLabs } from "@/services/voice/voice";

export const runtime = "nodejs";

const OPTIMIZE_LATENCY_VALUES = new Set([0, 1, 2, 3, 4]);

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const text = url.searchParams.get("text")?.trim();

  if (!text) {
    return new Response("Missing 'text' query parameter.", { status: 400 });
  }

  const voiceId = url.searchParams.get("voiceId") ?? undefined;
  const modelId = url.searchParams.get("modelId") ?? undefined;
  const optimizeLatencyParam = url.searchParams.get("optimizeLatency");
  const optimizeLatency = optimizeLatencyParam
    ? Number.parseInt(optimizeLatencyParam, 10)
    : undefined;

  const latencySetting =
    optimizeLatency !== undefined &&
    OPTIMIZE_LATENCY_VALUES.has(optimizeLatency)
      ? (optimizeLatency as 0 | 1 | 2 | 3 | 4)
      : undefined;

  try {
    const stream = await streamNarrationWithElevenLabs({
      text,
      voiceId,
      modelId,
      optimizeLatency: latencySetting,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to generate narration.";

    return Response.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}
