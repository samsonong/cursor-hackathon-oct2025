// app/api/tour/voice/route.ts
import {
  SESSIONS,
  MAX_TURNS,
  detectAndStripWakeWord,
  expiresAt,
  getSession,
  iso,
  isExpired,
  now,
  type Msg,
} from "../../lib/conversation";
import { TourGuideAgent } from "@/lib/tour-agent";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = (body?.text ?? "").toString().trim();
    const placeName = body?.placeName ? String(body.placeName) : undefined;
    const lat = typeof body?.lat === "number" ? body.lat : undefined;
    const lng = typeof body?.lng === "number" ? body.lng : undefined;
    const providedSessionId = body?.sessionId ? String(body.sessionId) : null;

    if (!text) {
      return Response.json({ error: "Missing 'text'." }, { status: 400 });
    }

    const session = getSession(providedSessionId);

    // Idle timeout check
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
      // End and clear session
      SESSIONS.delete(session.id);
      return Response.json(payload);
    }

    // Refresh activity
    session.lastSeenAt = now();

    // First turn → detect & strip wake word (non-strict if missing)
    let detectedWakeWord = false;
    let userText = text;
    if (session.turns === 0) {
      const res = detectAndStripWakeWord(text);
      detectedWakeWord = res.matched;
      userText = res.stripped || text;
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

    // Update session state
    const history = session.messages.slice(-MAX_TURNS * 2); // keep recent exchanges
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
  } catch (err: any) {
    return Response.json(
      { error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}

/**
 * .env.local
 * OPENAI_API_KEY=sk-...
 * GUIDE_MODEL=gpt-4o-mini  # optional
 *
 * Example:
 * curl -X POST http://localhost:3000/api/tour/voice \
 *   -H "content-type: application/json" \
 *   -d '{"text":"Hey Wei Jie, tell me about the architecture of Jewel","placeName":"Jewel Changi Airport"}'
 *
 * Notes:
 * - This uses an in-memory Map. Sessions reset on server restart and won't share across instances.
 * - Idle timeout is 30s from last request; subsequent calls refresh it.
 */
