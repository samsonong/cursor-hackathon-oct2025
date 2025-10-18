import { Agent, run, setDefaultOpenAIKey, tool } from "@openai/agents";
import { z } from "zod";
import knowledgeIndex from "@/data/changi-jewel/index.json";

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
  preferWebSearch?: boolean;
  runTrace: {
    knowledgeLookups: KnowledgeLookupTrace[];
  };
};

const KNOWLEDGE: KnowledgeIndexFile = knowledgeIndex;

export const MAX_QUERY_LENGTH = 3000;

const KNOWLEDGE_DIGEST_MODEL =
  process.env.KNOWLEDGE_DIGEST_MODEL ?? "gpt-4o-mini";

let knowledgeDigestAgent: Agent | null = null;

function ensureKnowledgeDigestAgent(): Agent {
  if (!knowledgeDigestAgent) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is required to run the knowledge digest agent."
      );
    }
    setDefaultOpenAIKey(apiKey);
    knowledgeDigestAgent = new Agent({
      name: "Jewel Knowledge Digest",
      model: KNOWLEDGE_DIGEST_MODEL,
      instructions:
        "You read curated Jewel Changi Airport notes and craft concise grounded answers. Reference entry names when helpful and keep replies to 2-3 sentences.",
    });
  }
  return knowledgeDigestAgent;
}

// Pre-compile regex for better performance
const TOKENIZE_REGEX = /[^a-z0-9\s]+/g;
const WHITESPACE_REGEX = /\s+/;

function tokenize(text: string): string[] {
  // Single pass: lowercase, clean, and split
  const cleaned = text.toLowerCase().replace(TOKENIZE_REGEX, " ");
  const tokens: string[] = [];
  let start = 0;

  // Manual split to avoid creating intermediate arrays
  for (let i = 0; i <= cleaned.length; i++) {
    if (i === cleaned.length || WHITESPACE_REGEX.test(cleaned[i])) {
      if (i > start) {
        tokens.push(cleaned.slice(start, i));
      }
      start = i + 1;
    }
  }

  return tokens;
}

function scoreEntry(
  entry: KnowledgeEntry,
  queryTokens: string[]
): KnowledgeMatch | null {
  let score = 0;
  let exactMatches = 0;

  // More sophisticated scoring with different weights
  for (const token of queryTokens) {
    // Exact matches in name get highest weight
    if (entry.name.toLowerCase().includes(token)) {
      score += 3;
      exactMatches++;
    }
    // Matches in summary get medium weight
    else if (entry.summary?.toLowerCase().includes(token)) {
      score += 2;
    }
    // Matches in details get lower weight
    else if (entry.details?.toLowerCase().includes(token)) {
      score += 1;
    }
    // Tag matches get medium weight
    else if (entry.tags?.some((tag) => tag.toLowerCase().includes(token))) {
      score += 2;
    }
  }

  if (score === 0) {
    return null;
  }

  // Boost score for entries with more exact matches
  score += exactMatches * 0.5;

  // Prepare highlights more efficiently
  const highlights: string[] = [];
  if (entry.summary) highlights.push(entry.summary);
  if (entry.details) highlights.push(entry.details);

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

  // Single pass: score, filter, and collect results
  const matches: KnowledgeMatch[] = [];

  for (const entry of KNOWLEDGE.entries) {
    const match = scoreEntry(entry, tokens);
    if (match) {
      matches.push(match);
    }
  }

  // Sort by score (descending) and take top results
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}

function buildKnowledgeContext(matches: KnowledgeMatch[]): string {
  if (!matches.length) {
    return "No indexed Jewel notes matched the request.";
  }

  // Pre-allocate array for better performance
  const lines: string[] = new Array(matches.length);

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const bullets = match.highlights
      .slice(0, 2)
      .map((snippet) => `- ${snippet}`);

    // Build source line more efficiently
    let sourceLine = "Sources: internal field notes.";
    if (match.sources?.length) {
      const sourceNotes = match.sources.map(
        (src) => `${src.type}${src.note ? ` (${src.note})` : ""}`
      );
      sourceLine = `Sources: ${sourceNotes.join("; ")}`;
    }

    lines[i] = [
      `Entry ${i + 1}: ${match.name} [${match.id}]`,
      ...bullets,
      sourceLine,
    ].join("\n");
  }

  return lines.join("\n\n");
}

function formatMatchesForDigest(matches: KnowledgeMatch[]): string {
  const result: string[] = new Array(matches.length);

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const parts: string[] = [`Entry ${i + 1}: ${match.name} [${match.id}]`];

    if (match.summary) {
      parts.push(`Summary: ${match.summary}`);
    }

    if (match.details) {
      const details = match.details.trim();
      const truncatedDetails =
        details.length > 400 ? `${details.slice(0, 400)}...` : details;
      parts.push(`Details: ${truncatedDetails}`);
    }

    if (match.tags?.length) {
      parts.push(`Tags: ${match.tags.join(", ")}`);
    }

    // Build source line efficiently
    let sourceLine = "Sources: internal field notes.";
    if (match.sources?.length) {
      const sourceNotes = match.sources.map(
        (src) => `${src.type}${src.note ? ` (${src.note})` : ""}`
      );
      sourceLine = `Sources: ${sourceNotes.join("; ")}`;
    }
    parts.push(sourceLine);

    result[i] = parts.join("\n");
  }

  return result.join("\n\n");
}

async function digestMatchesWithAgent(
  query: string,
  matches: KnowledgeMatch[]
): Promise<string | null> {
  if (!matches.length) {
    return null;
  }

  try {
    const agent = ensureKnowledgeDigestAgent();
    const formattedMatches = formatMatchesForDigest(matches);
    const prompt = [
      `Traveller question: ${query}`,
      "Grounded Jewel notes:",
      formattedMatches,
      "Respond as a friendly local guide. Use only the provided notes, keep to 2-3 sentences, mention entry names when helpful, and end with a short follow-up suggestion.",
    ].join("\n\n");

    const digestRun = await run(agent, prompt, { maxTurns: 4 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = (digestRun as any)?.finalOutput;
    if (typeof output === "string" && output.trim()) {
      return output.trim();
    }
  } catch (error) {
    console.warn("[TourGuideAgent] knowledge digest agent error", {
      error,
    });
  }

  return null;
}

// Tool that searches the curated Jewel knowledge index and records the lookup trace.
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
  execute: async (
    input: KnowledgeLookupInput,
    runCtx: { context?: TourAgentContext }
  ): Promise<string> => {
    const limit = input.limit ?? 3;
    const context = runCtx?.context as TourAgentContext | undefined;
    const minimumScore =
      input.minimumScore ?? context?.minimumKnowledgeScore ?? 1;

    console.info("[TourGuideAgent] searching knowledge index", {
      query: input.query,
    });

    // Get more matches initially to filter by score, then limit
    const allMatches = searchKnowledgeIndex(input.query, limit * 2);
    const matches = allMatches
      .filter((match) => match.score >= minimumScore)
      .slice(0, limit);

    // Update trace if context exists
    if (context?.runTrace) {
      context.runTrace.knowledgeLookups.push({
        query: input.query,
        limit,
        minimumScore,
        matches,
      });
    }

    console.info("[TourGuideAgent] knowledge lookup tool triggered", {
      query: input.query,
      limit,
      minimumScore,
      matches: matches.map((match) => ({
        id: match.id,
        score: match.score,
      })),
    });

    if (!matches.length) {
      return `No indexed knowledge matched "${input.query}".`;
    }

    // Build response more efficiently
    const matchCount = matches.length;
    const isPlural = matchCount !== 1;

    const summary = buildKnowledgeContext(matches);
    const digest = await digestMatchesWithAgent(input.query, matches);

    if (digest) {
      return `Knowledge digest from ${matchCount} entr${
        isPlural ? "ies" : "y"
      }\n\n${digest}\n\nSupporting notes:\n${summary}`;
    }

    return `Matched ${matchCount} knowledge entries for "${input.query}".\n\n${summary}`;
  },
});
