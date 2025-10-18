import { NextResponse } from "next/server";

interface DemoNarrationRequest {
  id: string;
  poiId: string;
  voiceId?: string;
  requestedAt: number;
}

const DEFAULT_POI_ID = "changi-jewel-main";

const pendingNarrations: DemoNarrationRequest[] = [];

function normalisePoiId(poiId: unknown): string {
  if (typeof poiId === "string" && poiId.trim().length > 0) {
    return poiId.trim();
  }

  return DEFAULT_POI_ID;
}

function normaliseVoiceId(voiceId: unknown): string | undefined {
  if (typeof voiceId === "string" && voiceId.trim().length > 0) {
    return voiceId.trim();
  }

  return undefined;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const poiId = normalisePoiId(body?.poiId);
    const voiceId = normaliseVoiceId(body?.voiceId);

    const requestEntry: DemoNarrationRequest = {
      id: crypto.randomUUID(),
      poiId,
      voiceId,
      requestedAt: Date.now(),
    };

    pendingNarrations.push(requestEntry);

    return NextResponse.json({ status: "queued", request: requestEntry });
  } catch (error) {
    console.error("Failed to enqueue demo narration request", error);
    return NextResponse.json(
      {
        error: "Unable to queue narration request.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  const next = pendingNarrations.shift() ?? null;
  return NextResponse.json({ next });
}
