import { promises as fs } from "fs";
import { dirname, resolve } from "path";

export type ConversationRecord = {
  user: string;
  assistant: string;
  timestamp: string;
  sessionId: string;
};

export type SessionConversationHistory = {
  [sessionId: string]: ConversationRecord[];
};

const DEFAULT_HISTORY_PATH = resolve(
  process.cwd(),
  "data/conversation-history.json"
);

function parseLimit(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

export class ConversationHistoryStore {
  private filePath: string;
  private maxEntries: number;

  constructor(opts?: { filePath?: string; maxEntries?: number }) {
    const envPath = process.env.CONVERSATION_HISTORY_FILE;
    this.filePath = opts?.filePath ?? envPath ?? DEFAULT_HISTORY_PATH;
    const envLimit = parseLimit(
      process.env.CONVERSATION_HISTORY_LIMIT,
      opts?.maxEntries ?? 50
    );
    this.maxEntries = envLimit;
  }

  async loadHistory(
    sessionId: string,
    limit = 10
  ): Promise<ConversationRecord[]> {
    return this.loadSessionHistory(sessionId, limit);
  }

  async loadSessionHistory(
    sessionId: string,
    limit = 10
  ): Promise<ConversationRecord[]> {
    const sessionHistory = await this.readSessionHistory();
    const records = sessionHistory[sessionId] || [];
    if (!records.length) {
      return [];
    }
    const sliceStart = Math.max(0, records.length - limit);
    return records.slice(sliceStart);
  }

  async append(record: ConversationRecord): Promise<void> {
    await this.appendToSession(record);
  }

  private async appendToSession(record: ConversationRecord): Promise<void> {
    const sessionHistory = await this.readSessionHistory();
    const sessionId = record.sessionId;

    if (!sessionHistory[sessionId]) {
      sessionHistory[sessionId] = [];
    }

    sessionHistory[sessionId].push(record);

    // Trim to max entries per session
    if (sessionHistory[sessionId].length > this.maxEntries) {
      sessionHistory[sessionId].splice(
        0,
        sessionHistory[sessionId].length - this.maxEntries
      );
    }

    await this.writeSessionHistory(sessionHistory);
  }

  private async readSessionHistory(): Promise<SessionConversationHistory> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return parsed as SessionConversationHistory;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return {};
      }
      console.warn("[ConversationHistory] read session history failed", {
        error,
      });
      return {};
    }
  }

  private async writeSessionHistory(
    sessionHistory: SessionConversationHistory
  ): Promise<void> {
    const directory = dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true });
    const payload = JSON.stringify(sessionHistory, null, 2);
    await fs.writeFile(this.filePath, payload, "utf-8");
  }
}
