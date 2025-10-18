import OpenAI from "openai";

import {
  SESSIONS,
  expiresAt,
  getSession,
  iso,
  isExpired,
  now,
} from "@/lib/conversation";
import { TourGuideAgent } from "@/lib/tour-agent";

const FRIENDLY_TONE_MODEL =
  process.env.OPENAI_FRIENDLY_TONE_MODEL ?? "gpt-4o-mini";

let cachedOpenAI: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (cachedOpenAI) {
    return cachedOpenAI;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required to adjust conversation tone with OpenAI."
    );
  }

  cachedOpenAI = new OpenAI({ apiKey });
  return cachedOpenAI;
}

async function rewriteReplyToFriendlyTone(
  text: string,
  lang: string
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }

  try {
    const client = getOpenAIClient();
    const response = await client.responses.create({
      model: FRIENDLY_TONE_MODEL,
      max_output_tokens: 500,
      input: [
        {
          role: "system",
          content:
            "You are a friendly local bringing your friend around your place. You are a singaporean and sound like a young woman in her early 20s — cheerful, confident, and slightly dramatic, with natural Singlish rhythm and tone. She speaks fast and animatedly, with casual English and light Singlish inflection (like “lah”, “leh”, “pls”, “eh”). The overall mood: charismatic, witty, expressive — a young Singaporean girl who can go from “LOL that one so cringe” to “but honestly, it’s kinda true lah”, with good pause using fullstops and break into paragraphs. Structure every reply as: (1) quick overview about the place, (2) personalised highlight that links to the traveller's interests or needs, BUT do not repeat my input (3) One leading question ONLY that invites them to continue exploring. Stay respectful, accessible, and keep it under 50 words.",
        },
        {
          role: "user",
          content: `Language style hint: ${lang}\n\nOriginal reply:\n${trimmed}\n\nRewrite this so it sounds friendly and conversational while retaining all guidance.`,
        },
      ],
    });

    const output = response.output_text?.trim();
    return output && output.length ? output : text;
  } catch (error) {
    console.warn("[ConversationAPI] friendly tone rewrite failed", { error });
    return text;
  }
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    console.log("api conversation is triggered");
    const body = await req.json().catch(() => ({}));
    const rawText = body?.text;
    const text =
      rawText === undefined || rawText === null ? "" : String(rawText);
    const trimmedText = text.trim();
    const strippedFromClient =
      typeof body?.strippedText === "string" ? body.strippedText.trim() : "";
    const placeName = body?.placeName ? String(body.placeName) : undefined;
    const lat = typeof body?.lat === "number" ? body.lat : undefined;
    const lng = typeof body?.lng === "number" ? body.lng : undefined;
    const providedSessionId = body?.sessionId ? String(body.sessionId) : null;

    if (!trimmedText && !strippedFromClient) {
      return Response.json({ error: "Missing 'text'." }, { status: 400 });
    }

    const session = getSession(providedSessionId);
    console.log("session", session);

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

    const detectedWakeWord =
      typeof body?.wakeWordDetected === "boolean"
        ? body.wakeWordDetected
        : session.turns === 0; // First turn requires wake word
    const userText = strippedFromClient || trimmedText;

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
      sessionId: session.id, // Pass the session ID to the tour agent
    });
    console.log("agentResult", agentResult);
    const reply = await rewriteReplyToFriendlyTone(agentResult.answer, lang);

    const history = session.messages;

    console.log("history", history);
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
    console.log("payload", payload);
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
