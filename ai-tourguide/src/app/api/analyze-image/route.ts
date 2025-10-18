import { analyzeImageAction } from "@/app/actions/analyze-image";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    
    const imageDataUrl = body?.imageDataUrl;
    const userQuestion = body?.userQuestion;
    const placeName = body?.placeName;
    const language = body?.language;

    if (!imageDataUrl) {
      return Response.json(
        { error: "Missing 'imageDataUrl' parameter." },
        { status: 400 }
      );
    }

    const result = await analyzeImageAction({
      imageDataUrl,
      userQuestion,
      placeName,
      language,
    });

    return Response.json(result);
  } catch (err: unknown) {
    console.error("Image analysis API error:", err);
    return Response.json(
      {
        error:
          err && typeof err === "object" && "message" in err
            ? String(
                (err as { message?: unknown }).message ?? "Unexpected error"
              )
            : "Unexpected error",
      },
      { status: 500 }
    );
  }
}
