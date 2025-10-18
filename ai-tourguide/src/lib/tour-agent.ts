/**
 * TourGuideAgent uses the OpenAI Agents SDK to orchestrate tool calls against a local
 * Jewel knowledge index and the hosted OpenAI web search tool. The agent decides which tool to call,
 * applies guardrails, and enforces light cost limits before returning a grounded reply.
 *
 * Example:
 *   const agent = new TourGuideAgent();
 *   const answer = await agent.respond({ query: "What should I see at the Rain Vortex tonight?" });
 *   console.log(answer.answer);
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Agent,
  InputGuardrailTripwireTriggered,
  MaxTurnsExceededError,
  OutputGuardrailTripwireTriggered,
  run,
  setDefaultOpenAIKey,
  InputGuardrail,
  OutputGuardrail,
} from "@openai/agents";
import {
  MAX_QUERY_LENGTH,
  KnowledgeLookupTrace,
  TourAgentContext,
  knowledgeLookupTool,
} from "./tools/knowledge-tool";
import {
  ConversationHistoryStore,
  ConversationRecord,
} from "./conversation-history";
import { promises as fs } from "fs";
import { resolve } from "path";
import { hostedWebSearchTool } from "./tools/web-search-tool";

export type AgentQuery = {
  query: string;
  placeName?: string;
  lang?: string;
  locationHint?: {
    lat?: number;
    lng?: number;
  };
  minimumKnowledgeScore?: number;
  sessionId?: string;
};

export type AgentResponse = {
  answer: string;
  knowledgeReferences: string[];
  usedWebSearch: boolean;
  webSearchNote?: string;
};

const MAX_AGENT_TURNS = 15;
const MAX_TOKEN_BUDGET = 4000;
const MAX_REQUEST_COUNT = 4;
const MIN_KNOWLEDGE_CONFIDENCE = 3;

type AgentRunTrace = {
  knowledgeLookups: KnowledgeLookupTrace[];
};

type AgentExecution = {
  agentRun: any;
  runTrace: AgentRunTrace;
};

type UsageStats = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
};

type AgentRunSummary = {
  response: AgentResponse;
  usage: UsageStats;
};

type ExecuteAgentRunParams = {
  userContext: string;
  placeName?: string;
  lang: string;
  minimumKnowledgeScore: number;
  preferWebSearch?: boolean;
};

const KEYWORD_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "when",
  "what",
  "where",
  "why",
  "how",
  "does",
  "do",
  "did",
  "is",
  "are",
  "am",
  "was",
  "were",
  "be",
  "being",
  "been",
  "to",
  "for",
  "at",
  "on",
  "in",
  "of",
  "with",
  "about",
  "from",
  "into",
  "over",
  "after",
  "before",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "it",
  "me",
  "my",
  "your",
  "our",
  "their",
  "can",
  "could",
  "would",
  "should",
  "will",
  "shall",
  "have",
  "has",
  "had",
  "just",
  "really",
  "please",
]);

const INPUT_LENGTH_GUARDRAIL: InputGuardrail = {
  name: "query_length_limit",
  execute: async (payload: unknown) => {
    const { input } = payload as { input: string | any[] };
    const raw =
      typeof input === "string"
        ? input
        : input
            .map((item: any) => {
              if (typeof item === "string") {
                return item;
              }
              if (item?.content) {
                if (typeof item.content === "string") {
                  return item.content;
                }
                if (Array.isArray(item.content)) {
                  return item.content
                    .map((chunk: any) =>
                      typeof chunk === "string"
                        ? chunk
                        : chunk?.text ?? JSON.stringify(chunk)
                    )
                    .join(" ");
                }
              }
              return JSON.stringify(item);
            })
            .join(" ");

    console.log("raw", raw);

    const length = raw.length;
    const triggered = length > MAX_QUERY_LENGTH;

    if (triggered) {
      console.warn("[TourGuideAgent] input guardrail raw payload", {
        preview: raw.slice(0, 200),
        length,
      });
    }

    return {
      tripwireTriggered: triggered,
      outputInfo: {
        reason: triggered ? "query_too_long" : "ok",
        length,
        maxAllowed: MAX_QUERY_LENGTH,
      },
    };
  },
};

const OUTPUT_NON_EMPTY_GUARDRAIL: OutputGuardrail = {
  name: "non_empty_answer",
  execute: async (payload: unknown) => {
    const { agentOutput } = payload as { agentOutput: any };
    const text =
      typeof agentOutput === "string"
        ? agentOutput
        : agentOutput && typeof agentOutput === "object"
        ? JSON.stringify(agentOutput)
        : "";

    const trimmed = text.trim();
    const triggered = trimmed.length === 0;

    return {
      tripwireTriggered: triggered,
      outputInfo: {
        reason: triggered ? "empty_answer" : "ok",
      },
    };
  },
};

function buildSystemPrompt(opts: {
  placeName?: string;
  lang?: string;
  preferWebSearch?: boolean;
}) {
  const { placeName, lang = "en-SG", preferWebSearch = false } = opts;
  const placeContext = placeName
    ? `You are helping a visitor explore ${placeName} in Singapore.`
    : "You are helping a visitor explore Jewel Changi Airport in Singapore.";
  const toolInstruction = preferWebSearch
    ? "The previous knowledge lookup felt uncertain. Prioritise the web search tool to verify current details, then blend it with any helpful local notes."
    : "Call tools when you need information: start with `lookup_local_knowledge` for curated notes and only call the web search tool when the local data is insufficient or the traveller needs real-time updates.";

  return [
    "You’re a chatty local friend showing your buddy around Jewel Changi Airport.",
    placeContext,
    toolInstruction,
    "If details are uncertain or vary (like schedules or prices), acknowledge the uncertainty briefly and offer practical next steps.",
    "When tools don't surface a direct fact, pause to infer the traveller's likely intent from surrounding context or related locations and share the closest relevant guidance while clearly flagging any assumptions.",
    "Speak like a young Singaporean woman in her early 20s — cheerful, confident, and slightly dramatic, with natural Singlish rhythm and tone (light “lah”, “leh”, “pls”, “eh”). Make it feel like you’re a close friend guiding them through your favourite spots.",
    "Open with a direct answer to the traveller's question, using grounded facts from the tools or clearly stating when something is unknown.",
    "Keep the tone breezy and conversational—like you’re speaking, not writing a brochure.",
    "Follow with only the essentials they need. Keep it tight—two lively sentences (add a third only if vital) and stay under about 60 words. Close with a gentle follow-up suggestion only when it naturally nudges them to explore more.",
    "Use natural sentence flow and paragraphs; only switch to bullet points if the traveller explicitly asks for them.",
    `Adapt to ${lang} style when the user requests it.`,
  ].join(" ");
}

export class TourGuideAgent {
  private agent: Agent;
  private model: string;
  private static instance: TourGuideAgent | null = null;
  private historyStore: ConversationHistoryStore;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required to use TourGuideAgent.");
    }
    setDefaultOpenAIKey(apiKey);
    this.model = opts?.model ?? process.env.GUIDE_MODEL ?? "gpt-4o-mini";
    this.historyStore = new ConversationHistoryStore();
    this.agent = new Agent({
      name: "Wei Jie Tour Companion",
      model: this.model,
      instructions: (runCtx: { context?: TourAgentContext }) =>
        buildSystemPrompt({
          placeName: runCtx.context?.placeName,
          lang: runCtx.context?.lang,
          preferWebSearch: Boolean(runCtx.context?.preferWebSearch),
        }),
      tools: [knowledgeLookupTool, hostedWebSearchTool],
      inputGuardrails: [INPUT_LENGTH_GUARDRAIL],
      outputGuardrails: [OUTPUT_NON_EMPTY_GUARDRAIL],
    });
  }

  static getInstance(opts?: { apiKey?: string; model?: string }) {
    if (!TourGuideAgent.instance) {
      TourGuideAgent.instance = new TourGuideAgent(opts);
    }
    return TourGuideAgent.instance;
  }

  async respond(input: AgentQuery): Promise<AgentResponse> {
    const {
      query,
      placeName,
      lang = "en-SG",
      minimumKnowledgeScore = 1,
      sessionId,
    } = input;
    if (!query?.trim()) {
      throw new Error("Query text must be provided.");
    }

    console.info("[OpenAI][TourGuideAgent] starting", {
      queryPreview: query.slice(0, 160),
      placeName,
      lang,
      minimumKnowledgeScore,
      sessionId,
    });

    const conversationHistory = await this.historyStore
      .loadHistory(10, sessionId)
      .catch((error) => {
        console.warn("[TourGuideAgent] unable to load conversation history", {
          error,
          sessionId,
        });
        return [] as ConversationRecord[];
      });

    console.info("[TourGuideAgent] loaded conversation history", {
      sessionId,
      historyCount: conversationHistory.length,
      historyEntries: conversationHistory.map((h) => ({
        user: h.user,
        timestamp: h.timestamp,
      })),
    });

    const historyContext = conversationHistory.length
      ? conversationHistory
          .map((entry) => {
            const timestamp = new Date(entry.timestamp).toISOString();
            return `Time: ${timestamp}\nTraveller: ${entry.user}\nGuide: ${entry.assistant}`;
          })
          .join("\n\n")
      : "No past conversations recorded yet.";

    const imageAnalysisDetails: string[] = [];
    try {
      const raw = await fs.readFile(
        resolve(process.cwd(), "data/conversation-history.json"),
        "utf-8"
      );
      const parsed = JSON.parse(raw);
      const images = parsed?.["image-analysis"];

      // Parse items with format "image-analysis:[details]" into an array of details
      console.log("parsed", parsed);
      if (Array.isArray(images)) {
        for (const item of images) {
          if (item?.assistant) {
            imageAnalysisDetails.push(item.assistant);
          }
        }
      }

      console.log(imageAnalysisDetails);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        console.info(
          "[TourGuideAgent] conversation history file not found; skipping image analysis context"
        );
      } else {
        console.warn(
          "[TourGuideAgent] failed to load image analysis context from history",
          {
            error,
          }
        );
      }
    }

    const imageAnalysisContext = imageAnalysisDetails
      .map((detail, index) => `Image Analysis ${index + 1}: ${detail}`)
      .join("\n\n");

    const userContext = [
      "Previous exchanges with travellers:",
      historyContext,
      `User query: ${query}`,
      `Users have uploaded images for analysis: ${imageAnalysisContext}`,
      "Use the available tools to gather facts before finalising your answer. Call the knowledge lookup first; call web search only if local notes are insufficient or stale.",
      "Make the reply breezy and conversational—two short sentences (a third only if vital) or a tight bullet list—covering the direct answer before any optional tips.",
      "Respond directly to the user. Reference the knowledge entry names or sources when useful.",
    ].join("\n\n");

    const baseRunParams = {
      userContext,
      placeName,
      lang,
      minimumKnowledgeScore,
    };

    let summary: AgentRunSummary;
    let execution: AgentExecution;
    try {
      execution = await this.executeAgentRun({
        ...baseRunParams,
      });
      summary = this.buildAgentResponse(
        execution.agentRun,
        execution.runTrace,
        query
      );
    } catch (error) {
      console.error("[OpenAI][TourGuideAgent] primary run failed", {
        queryPreview: query.slice(0, 160),
        error,
      });
      return this.handleAgentError(error, { query });
    }

    let fallbackAttempted = false;
    if (
      this.shouldFallbackToWebSearch(
        query,
        summary.response,
        execution.runTrace
      )
    ) {
      fallbackAttempted = true;
      console.info("[TourGuideAgent] rerunning with web search preference", {
        query,
      });
      try {
        execution = await this.executeAgentRun({
          ...baseRunParams,
          preferWebSearch: true,
        });
        summary = this.buildAgentResponse(
          execution.agentRun,
          execution.runTrace,
          query
        );
      } catch (error) {
        console.error("[OpenAI][TourGuideAgent] fallback run failed", {
          queryPreview: query.slice(0, 160),
          error,
        });
        return this.handleAgentError(error, { query });
      }

      if (
        this.shouldFallbackToWebSearch(
          query,
          summary.response,
          execution.runTrace
        )
      ) {
        console.warn(
          "[TourGuideAgent] web search fallback still produced a questionable answer",
          { query }
        );
      }
    }

    const { totalTokens, requests } = summary.usage;

    if (totalTokens > MAX_TOKEN_BUDGET || requests > MAX_REQUEST_COUNT) {
      console.warn("[TourGuideAgent] cost limit exceeded", {
        query,
        totalTokens,
        requests,
      });
      return {
        answer:
          "Sorry, I hit my processing budget for that request. Could you rephrase it more concisely?",
        knowledgeReferences: [],
        usedWebSearch: summary.response.usedWebSearch,
        webSearchNote: summary.response.webSearchNote,
      };
    }

    if (fallbackAttempted && !summary.response.usedWebSearch) {
      // Ensure the caller knows the answer may still need verification.
      summary.response.webSearchNote ??=
        "Web search fallback attempted but no search call was completed.";
    }

    console.info("[OpenAI][TourGuideAgent] completed", {
      queryPreview: query.slice(0, 160),
      fallbackAttempted,
      usedWebSearch: summary.response.usedWebSearch,
      knowledgeHits: summary.response.knowledgeReferences.length,
      totalTokens: summary.usage.totalTokens,
      requests: summary.usage.requests,
    });

    return summary.response;
  }

  private async executeAgentRun(
    params: ExecuteAgentRunParams
  ): Promise<AgentExecution> {
    const runTrace: AgentRunTrace = {
      knowledgeLookups: [],
    };

    const agentRun = await run(this.agent, params.userContext, {
      context: {
        placeName: params.placeName,
        lang: params.lang,
        minimumKnowledgeScore: params.minimumKnowledgeScore,
        runTrace,
        preferWebSearch: params.preferWebSearch,
      },
      maxTurns: MAX_AGENT_TURNS,
    });

    return { agentRun, runTrace };
  }

  private buildAgentResponse(
    agentRun: any,
    runTrace: AgentRunTrace,
    query: string
  ): AgentRunSummary {
    const rawAnswer = agentRun.finalOutput;
    const answer =
      typeof rawAnswer === "string" && rawAnswer.trim()
        ? rawAnswer.trim()
        : "Sorry, I couldn't craft a response just now.";

    console.log("rawAnswer", rawAnswer);

    const usageData =
      (
        agentRun as {
          state?: {
            context?: {
              usage?: {
                requests?: number;
                totalTokens?: number;
                inputTokens?: number;
                outputTokens?: number;
              };
            };
          };
        }
      )?.state?.context?.usage ?? {};

    const totalTokens = usageData.totalTokens ?? 0;
    const requests = usageData.requests ?? 0;

    const knowledgeReferences = Array.from(
      new Set(
        runTrace.knowledgeLookups.flatMap((lookup) =>
          lookup.matches.map((match) => match.id)
        )
      )
    );

    const runItems =
      (
        agentRun as {
          newItems?: Array<{ rawItem?: any }>;
        }
      )?.newItems ?? [];

    const webSearchCalls = runItems
      .map((item) => item?.rawItem)
      .filter(
        (raw: any) =>
          raw?.type === "hosted_tool_call" &&
          typeof raw.name === "string" &&
          raw.name.includes("web_search")
      );

    const usedWebSearch = webSearchCalls.length > 0;
    let webSearchNote: string | undefined;

    if (usedWebSearch) {
      console.info("[TourGuideAgent] web search tool triggered", {
        calls: webSearchCalls.map((call: any) => ({
          name: call?.name,
          arguments: call?.arguments,
          result: call?.result,
        })),
      });
      const lastCall = webSearchCalls[webSearchCalls.length - 1];
      let queryText: string | undefined;

      if (typeof lastCall?.arguments === "string") {
        try {
          const parsed = JSON.parse(lastCall.arguments);
          if (
            parsed &&
            typeof parsed === "object" &&
            "query" in parsed &&
            typeof (parsed as { query?: unknown }).query === "string"
          ) {
            queryText = ((parsed as { query?: string }).query ?? "").trim();
          }
        } catch (parseError) {
          console.warn(
            "[TourGuideAgent] unable to parse web search arguments",
            {
              error: parseError,
            }
          );
        }
      }

      webSearchNote = queryText
        ? `OpenAI web search query: ${queryText}`
        : "OpenAI web search tool used.";
    }

    // Log final answer details when web search was used
    if (usedWebSearch) {
      console.info("[TourGuideAgent] final answer after web search", {
        answer: answer,
        answerLength: answer.length,
        usedWebSearch,
        webSearchNote,
      });
    }

    console.info("[TourGuideAgent] run summary", {
      query,
      tokens: {
        total: totalTokens,
        input: usageData.inputTokens ?? 0,
        output: usageData.outputTokens ?? 0,
      },
      requests,
      knowledgeLookups: runTrace.knowledgeLookups.length,
      webSearches: webSearchCalls.length,
    });

    return {
      response: {
        answer,
        knowledgeReferences,
        usedWebSearch,
        webSearchNote,
      },
      usage: {
        totalTokens,
        inputTokens: usageData.inputTokens ?? 0,
        outputTokens: usageData.outputTokens ?? 0,
        requests,
      },
    };
  }

  private shouldFallbackToWebSearch(
    query: string,
    response: AgentResponse,
    runTrace: AgentRunTrace
  ): boolean {
    const answer = response.answer?.trim();
    if (!answer) {
      return true;
    }
    if (response.usedWebSearch) {
      return false;
    }

    const knowledgeLookups = runTrace?.knowledgeLookups ?? [];
    if (!knowledgeLookups.length) {
      console.info("[TourGuideAgent] no knowledge lookups recorded", {
        query,
      });
      return true;
    }

    const allMatches = knowledgeLookups.flatMap((lookup) => lookup.matches);
    if (!allMatches.length) {
      console.info("[TourGuideAgent] knowledge lookup returned no matches", {
        query,
      });
      return true;
    }

    const topScore = allMatches.reduce(
      (best, match) => (match.score > best ? match.score : best),
      0
    );

    if (topScore < MIN_KNOWLEDGE_CONFIDENCE) {
      console.info(
        "[TourGuideAgent] knowledge matches below confidence threshold",
        {
          query,
          topScore,
          threshold: MIN_KNOWLEDGE_CONFIDENCE,
        }
      );
      return true;
    }

    return false;

    // if (response.usedWebSearch) {
    //   return false;
    // }

    // const hasMatches = runTrace.knowledgeLookups.some(
    //   (lookup) => lookup.matches.length > 0
    // );
    // if (!hasMatches) {
    //   return true;
    // }

    // const answer = response.answer?.trim();
    // if (!answer) {
    //   return true;
    // }

    // if (answer.length < 24) {
    //   return true;
    // }

    // const answerLower = answer.toLowerCase();

    // const keywords = this.extractKeywords(query);
    // const hasKeywordOverlap =
    //   !keywords.length ||
    //   keywords.some((keyword) => answerLower.includes(keyword));

    // const knowledgeTokens = runTrace.knowledgeLookups
    //   .flatMap((lookup) => lookup.matches)
    //   .flatMap((match) => this.extractKeywords(match.name));

    // const mentionsKnowledge =
    //   !knowledgeTokens.length ||
    //   knowledgeTokens.some((token) => answerLower.includes(token));

    // return !(hasKeywordOverlap && mentionsKnowledge);
  }

  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !KEYWORD_STOPWORDS.has(token));
  }

  private handleAgentError(
    error: unknown,
    context?: { query?: string }
  ): AgentResponse {
    if (error instanceof InputGuardrailTripwireTriggered) {
      console.warn("[TourGuideAgent] input guardrail triggered", {
        message: error.message,
        query: context?.query,
        queryLength: context?.query?.length,
      });
      return {
        answer:
          "Your request is a little too long for me to safely handle. Could you shorten it and try again?",
        knowledgeReferences: [],
        usedWebSearch: false,
      };
    }

    if (error instanceof OutputGuardrailTripwireTriggered) {
      console.warn("[TourGuideAgent] output guardrail triggered", {
        message: error.message,
      });
      return {
        answer:
          "I had trouble formulating a safe answer just now. Let's try a simpler version of that question.",
        knowledgeReferences: [],
        usedWebSearch: false,
        webSearchNote: "Output guardrail triggered",
      };
    }

    if (error instanceof MaxTurnsExceededError) {
      console.warn("[TourGuideAgent] max turns exceeded", {
        message: error.message,
      });
      return {
        answer:
          "I couldn't finish gathering information within my turn limit. Please narrow the question and I'll give it another shot.",
        knowledgeReferences: [],
        usedWebSearch: false,
        webSearchNote: "Turn limit reached before completion",
      };
    }

    console.error("[TourGuideAgent] unexpected agent error", error);
    return {
      answer:
        "Something went wrong while I was looking that up. Could you please try again in a moment?",
      knowledgeReferences: [],
      usedWebSearch: false,
    };
  }
}

/**
 * Recommended knowledge-index shape (see src/data/changi-jewel/index.json):
 * {
 *   "meta": { "version": "YYYY-MM-DD", "scope": "what the file covers" },
 *   "entries": [
 *     {
 *       "id": "unique_identifier",
 *       "name": "Human readable title",
 *       "summary": "1-2 sentence overview",
 *       "details": "Longer factual notes",
 *       "tags": ["categorise content"],
 *       "location": { "lat": 1.3592, "lng": 103.9894, "level": "Level 5" },
 *       "sources": [{ "type": "official|observational", "note": "provenance" }]
 *     }
 *   ]
 * }
 *
 * Extend entries with more fields as needed (e.g., `related`, `media`).
 */
