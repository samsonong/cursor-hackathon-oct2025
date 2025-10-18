import { tool } from "@openai/agents";
import { z } from "zod";
import knowledgeIndex from "../../data/changi-jewel/index.json";

export type KnowledgeSource = {
  type: string;
  note?: string;
  url?: string;
};

export type KnowledgeEntry = {
  id: string;
  name: string;
  summary: string;
  details: string;
  tags?: string[];
  location?: {
    lat?: number;
    lng?: number;
    level?: string;
  };
  sources?: KnowledgeSource[];
};

type KnowledgeIndexFile = {
  meta: {
    version: string;
    scope?: string;
    notes?: string;
  };
  entries: KnowledgeEntry[];
};

export type KnowledgeMatch = KnowledgeEntry & {
  score: number;
  highlights: string[];
};

export type KnowledgeLookupTrace = {
  query: string;
  limit: number;
  minimumScore: number;
  matches: KnowledgeMatch[];
};

export type TourAgentContext = {
  placeName?: string;
  lang?: string;
  minimumKnowledgeScore?: number;
  runTrace: {
    knowledgeLookups: KnowledgeLookupTrace[];
  };
};

const KNOWLEDGE: KnowledgeIndexFile = knowledgeIndex;

export const MAX_QUERY_LENGTH = 280;

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreEntry(
  entry: KnowledgeEntry,
  queryTokens: string[]
): KnowledgeMatch | null {
  const haystack = [
    entry.name,
    entry.summary,
    entry.details,
    entry.tags?.join(" ") ?? "",
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  const highlights: string[] = [];

  queryTokens.forEach((token) => {
    if (haystack.includes(token)) {
      score += 1;
    }
  });

  if (score === 0) {
    return null;
  }

  if (entry.summary) {
    highlights.push(entry.summary);
  }
  if (entry.details) {
    highlights.push(entry.details);
  }

  return { ...entry, score, highlights };
}

function searchKnowledgeIndex(query: string, limit = 3): KnowledgeMatch[] {
  if (!query.trim()) {
    return [];
  }

  const tokens = tokenize(query);
  if (!tokens.length) {
    return [];
  }

  const matches = KNOWLEDGE.entries
    .map((entry) => scoreEntry(entry, tokens))
    .filter((match): match is KnowledgeMatch => Boolean(match))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return matches;
}

function buildKnowledgeContext(matches: KnowledgeMatch[]) {
  if (!matches.length) {
    return "No indexed Jewel notes matched the request.";
  }
  const lines: string[] = matches.map((match, index) => {
    const bullets = match.highlights
      .slice(0, 2)
      .map((snippet) => `- ${snippet}`);
    const sourceNotes =
      match.sources?.map(
        (src) => `${src.type}${src.note ? ` (${src.note})` : ""}`
      ) ?? [];
    const sourceLine = sourceNotes.length
      ? `Sources: ${sourceNotes.join("; ")}`
      : "Sources: internal field notes.";
    return [
      `Entry ${index + 1}: ${match.name} [${match.id}]`,
      ...bullets,
      sourceLine,
    ].join("\n");
  });
  return lines.join("\n\n");
}

// Tool that searches the curated knowledge index and records the lookup trace.
const KNOWLEDGE_LOOKUP_PARAMETERS = z
  .object({
    query: z.string().min(1).max(MAX_QUERY_LENGTH),
    limit: z.number().int().min(1).max(5).optional().nullable(),
    minimumScore: z.number().int().min(0).max(10).optional().nullable(),
  })
  .strict();

type KnowledgeLookupInput = z.infer<typeof KNOWLEDGE_LOOKUP_PARAMETERS>;

export const knowledgeLookupTool = tool({
  name: "lookup_local_knowledge",
  description:
    "Search the curated Jewel Changi Airport knowledge base for relevant entries. Use this before considering a web search.",
  parameters: KNOWLEDGE_LOOKUP_PARAMETERS,
  strict: true,
  execute: async (input: KnowledgeLookupInput, runCtx): Promise<string> => {
    const limit = input.limit ?? 3;
    const context = runCtx?.context as TourAgentContext | undefined;
    const minimumScore =
      input.minimumScore ?? context?.minimumKnowledgeScore ?? 1;
    const matches = searchKnowledgeIndex(input.query, limit).filter(
      (match) => match.score >= minimumScore
    );

    if (context?.runTrace) {
      context.runTrace.knowledgeLookups.push({
        query: input.query,
        limit,
        minimumScore,
        matches,
      });
    }

    if (!matches.length) {
      return `No indexed knowledge matched "${input.query}".`;
    }

    const summary = buildKnowledgeContext(matches);
    return [
      `Matched ${matches.length} knowledge entries for "${input.query}".`,
      summary,
    ].join("\n\n");
  },
});
