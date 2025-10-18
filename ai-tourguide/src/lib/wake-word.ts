const DEFAULT_WAKE_WORD =
  process.env.NEXT_PUBLIC_WAKE_WORD || process.env.WAKE_WORD || "hey wei jie";

export type WakeWordDetectionResult = {
  matched: boolean;
  stripped: string;
  wakeWord: string;
};

function buildWakeWordPattern(wakeWord: string) {
  const trimmed = wakeWord.trim();
  if (!trimmed) {
    return /^$/i;
  }

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const segmentPattern = escaped.split(/\\s+/).join("\\s*");

  return new RegExp(`(^|\\b)${segmentPattern}(?:\\b|[\\s,.:;!?-])`, "i");
}

export function detectAndStripWakeWord(
  text: string,
  wakeWord: string = DEFAULT_WAKE_WORD
): WakeWordDetectionResult {
  const norm = text.trim();
  const pattern = buildWakeWordPattern(wakeWord);
  const matched = pattern.test(norm);
  const stripped = matched ? norm.replace(pattern, "").trim() : norm;

  return {
    matched,
    stripped,
    wakeWord,
  };
}

export function hasWakeWordPrefix(text: string, wakeWord = DEFAULT_WAKE_WORD) {
  return detectAndStripWakeWord(text, wakeWord).matched;
}

export function getWakeWord(): string {
  return DEFAULT_WAKE_WORD;
}
