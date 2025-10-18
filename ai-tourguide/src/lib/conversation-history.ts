import { promises as fs } from "fs";
import { dirname, resolve } from "path";

export type ConversationRecord = {
  user: string;
  assistant: string;
  timestamp: string;
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

  async loadHistory(limit = 10): Promise<ConversationRecord[]> {
    const records = await this.readAll();
    if (!records.length) {
      return [];
    }
    const sliceStart = Math.max(0, records.length - limit);
    return records.slice(sliceStart);
  }

  async append(record: ConversationRecord): Promise<void> {
    const records = await this.readAll();
    records.push(record);
    if (records.length > this.maxEntries) {
      records.splice(0, records.length - this.maxEntries);
    }
    await this.writeAll(records);
  }

  private async readAll(): Promise<ConversationRecord[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ConversationRecord[]) : [];
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return [];
      }
      console.warn("[ConversationHistory] read failed", { error });
      return [];
    }
  }

  private async writeAll(records: ConversationRecord[]): Promise<void> {
    const directory = dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true });
    const payload = JSON.stringify(records, null, 2);
    await fs.writeFile(this.filePath, payload, "utf-8");
  }
}
