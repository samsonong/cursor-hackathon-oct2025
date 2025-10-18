import {
  SESSIONS,
  MAX_TURNS,
  expiresAt,
  getSession,
  iso,
  isExpired,
  now,
} from "@/lib/conversation";
import { detectAndStripWakeWord } from "@/lib/wake-word";
import { TourGuideAgent } from "@/lib/tour-agent";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawText = body?.text;
    const text =
      rawText === undefined || rawText === null ? "" : String(rawText);
    const trimmedText = text.trim();
    const strippedFromClient =
      typeof body?.strippedText === "string" ? body.strippedText.trim() : "";
    const wakeWordOverride =
      typeof body?.wakeWord === "string" && body.wakeWord.trim()
        ? body.wakeWord.trim()
        : undefined;
    const placeName = body?.placeName ? String(body.placeName) : undefined;
    const lat = typeof body?.lat === "number" ? body.lat : undefined;
    const lng = typeof body?.lng === "number" ? body.lng : undefined;
    const providedSessionId = body?.sessionId ? String(body.sessionId) : null;

    if (!trimmedText && !strippedFromClient) {
      return Response.json({ error: "Missing 'text'." }, { status: 400 });
    }

    const session = getSession(providedSessionId);

    if (isExpired(session)) {
      const payload = {
        sessionId: session.id,
        reply: "I'll pause here. Use the wake word to pick up again.",
        ended: true,
        endReason: "idle_timeout" as const,
        meta: {
          turn: session.turns,
          lastSeenAt: iso(session.lastSeenAt),
          expiresAt: iso(expiresAt(session)),
          detectedWakeWord: false,
        },
      };
      SESSIONS.delete(session.id);
      return Response.json(payload);
    }

    session.lastSeenAt = now();

    let detectedWakeWord = false;
    let userText = strippedFromClient || trimmedText;
    if (session.turns === 0) {
      const hasClientWakeFlag =
        body && Object.prototype.hasOwnProperty.call(body, "wakeWordDetected");
      if (hasClientWakeFlag) {
        detectedWakeWord = Boolean(body.wakeWordDetected);
        if (detectedWakeWord) {
          if (!strippedFromClient) {
            const res = detectAndStripWakeWord(trimmedText, wakeWordOverride);
            detectedWakeWord = res.matched;
            userText = res.stripped || trimmedText;
          }
        } else {
          userText = strippedFromClient || trimmedText;
        }
      } else {
        const res = detectAndStripWakeWord(trimmedText, wakeWordOverride);
        detectedWakeWord = res.matched;
        userText = res.stripped || trimmedText;
      }
    }

    const requestedLang =
      body?.lang !== undefined ? String(body.lang) : undefined;
    const lang = requestedLang ?? session.lang ?? "en-SG";

    const agent = TourGuideAgent.getInstance();
    const agentResult = await agent.respond({
      query: userText,
      placeName,
      lang,
      locationHint:
        typeof lat === "number" && typeof lng === "number"
          ? { lat, lng }
          : undefined,
    });
    const reply = agentResult.answer;

    const history = session.messages.slice(-MAX_TURNS * 2);
    session.messages = [
      ...history,
      { role: "user", content: userText },
      { role: "assistant", content: reply },
    ];
    session.turns += 1;
    session.lang = lang;
    session.lastSeenAt = now();

    const payload = {
      sessionId: session.id,
      reply,
      ended: false,
      endReason: null as null,
      meta: {
        turn: session.turns,
        lastSeenAt: iso(session.lastSeenAt),
        expiresAt: iso(expiresAt(session)),
        detectedWakeWord,
        knowledgeReferences: agentResult.knowledgeReferences,
        usedWebSearch: agentResult.usedWebSearch,
        webSearchNote: agentResult.webSearchNote,
      },
    };
    return Response.json(payload);
  } catch (err: unknown) {
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

