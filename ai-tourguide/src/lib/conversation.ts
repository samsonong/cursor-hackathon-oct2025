export type Msg = { role: "system" | "user" | "assistant"; content: string };
export type Session = {
  id: string;
  messages: Msg[];
  lastSeenAt: number;
  turns: number;
  lang?: string;
};

export const SESSIONS = new Map<string, Session>();
export const IDLE_MS = 30_000;
export const MAX_TURNS = 8;

export function now() {
  return Date.now();
}

export function iso(ts: number) {
  return new Date(ts).toISOString();
}

function newSession(): Session {
  const id = crypto.randomUUID();
  return { id, messages: [], lastSeenAt: now(), turns: 0, lang: undefined };
}

export function getSession(sessionId?: string | null) {
  if (sessionId && SESSIONS.has(sessionId)) {
    return SESSIONS.get(sessionId)!;
  }
  const s = newSession();
  SESSIONS.set(s.id, s);
  return s;
}

export function isExpired(session: Session) {
  return now() - session.lastSeenAt > IDLE_MS;
}

export function expiresAt(session: Session) {
  return session.lastSeenAt + IDLE_MS;
}

export function buildSystemPrompt(opts: {
  placeName?: string;
  lat?: number;
  lng?: number;
}) {
  const { placeName, lat, lng } = opts;
  const where = placeName
    ? `You are travelling the user at ${placeName}.`
    : lat != null && lng != null
    ? `You are with the user at coordinates (${lat.toFixed(4)}, ${lng.toFixed(
        4
      )}).`
    : `You are travelling with the user.`;

  return [
    `You are a local, knowledgeable friend and tour companion. ${where}`,
    `Be concise (2–4 sentences). Offer 1 tiny follow-up suggestion.`,
    `Do not invent exact prices, opening hours, or ticket rules; say if you're unsure.`,
  ].join(" ");
}
