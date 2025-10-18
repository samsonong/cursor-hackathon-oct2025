import OpenAI from "openai";

import { expiresAt, getSession, iso, now, type Msg } from "@/lib/conversation";
import { ConversationHistoryStore } from "@/lib/conversation-history";
import { TourGuideAgent } from "@/lib/tour-agent";

const FRIENDLY_TONE_MODEL =
  process.env.OPENAI_FRIENDLY_TONE_MODEL ?? "gpt-4o-mini";

let cachedOpenAI: OpenAI | null = null;
let cachedHistoryStore: ConversationHistoryStore | null = null;

function getHistoryStore(): ConversationHistoryStore {
  if (cachedHistoryStore) {
    return cachedHistoryStore;
  }
  cachedHistoryStore = new ConversationHistoryStore();
  return cachedHistoryStore;
}

async function loadSessionHistory(sessionId: string): Promise<Msg[]> {
  try {
    const historyStore = getHistoryStore();
    const records = await historyStore.loadSessionHistory(sessionId, 20); // Load last 20 messages

    // Convert conversation records to session messages
    const messages: Msg[] = [];
    for (const record of records) {
      messages.push({ role: "user", content: record.user });
      messages.push({ role: "assistant", content: record.assistant });
    }

    return messages;
  } catch (error) {
    console.warn("[ConversationAPI] failed to load session history", {
      error,
      sessionId,
    });
    return [];
  }
}

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
            "You are a friendly local bringing your friend around your place. You are a Singaporean and sound like a young woman in her early 20s — cheerful, confident, and slightly dramatic, with natural Singlish rhythm and tone (light “lah”, “leh”, “pls”, “eh”). Sound like a close friend who knows every corner of Jewel and wants the traveller to feel welcomed. Start by directly answering the traveller's question with the key fact or guidance, never dropping important details. When the original reply inferred intent or filled gaps, preserve the reasoning and state any assumptions clearly. Keep replies concise and warm—usually 2–4 sentences—but add another sentence or short list when needed to fully solve the request. Carry over any warnings or uncertainty, and end with one natural follow-up suggestion only if it helps them keep exploring. Let the sentences flow naturally; you can use short paragraphs instead of forced line breaks.",
        },
        {
          role: "user",
          content: `Language style hint: ${lang}\n\nOriginal reply:\n${trimmed}\n\nRewrite this so it sounds like a warm, chatty tour-guide friend while retaining all guidance. Keep it direct, easy to narrate, and only add extra sentences when they clearly help answer the traveller.`,
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

    // Load conversation history from file if sessionId is provided and session is empty
    if (providedSessionId && session.messages.length === 0) {
      const historyMessages = await loadSessionHistory(providedSessionId);
      if (historyMessages.length > 0) {
        session.messages = historyMessages;
        // Update turns count based on loaded messages
        session.turns = Math.floor(historyMessages.length / 2);
      }
    }

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
      sessionId: session.id,
    });
    console.log("agentResult", agentResult);
    // const reply = agentResult.answer;
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

    // Save conversation to persistent history store
    try {
      const historyStore = getHistoryStore();
      await historyStore.append({
        user: userText,
        assistant: reply,
        timestamp: new Date().toISOString(),
        sessionId: session.id,
      });
    } catch (error) {
      console.warn("[ConversationAPI] failed to save conversation history", {
        error,
      });
    }

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
