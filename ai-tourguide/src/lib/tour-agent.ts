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
};

export type AgentResponse = {
  answer: string;
  knowledgeReferences: string[];
  usedWebSearch: boolean;
  webSearchNote?: string;
};

const MAX_AGENT_TURNS = 4;
const MAX_TOKEN_BUDGET = 4000;
const MAX_REQUEST_COUNT = 4;

const INPUT_LENGTH_GUARDRAIL: InputGuardrail = {
  name: "query_length_limit",
  execute: async ({ input }: { input: string | any[] }) => {
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

    const length = raw.length;
    const triggered = length > MAX_QUERY_LENGTH;

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
  execute: async ({ agentOutput }: { agentOutput: any }) => {
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

function buildSystemPrompt(opts: { placeName?: string; lang?: string }) {
  const { placeName, lang = "en-SG" } = opts;
  const placeContext = placeName
    ? `You are helping a visitor explore ${placeName} in Singapore.`
    : "You are helping a visitor explore Jewel Changi Airport in Singapore.";

  return [
    "You are Wei Jie, a friendly, well-informed local tour companion focused on Jewel Changi Airport.",
    placeContext,
    "Call tools when you need information: start with `lookup_local_knowledge` for curated notes and only call `run_web_search` when the local data is insufficient or the traveller needs real-time updates.",
    "If details are uncertain or vary (like schedules or prices), acknowledge the uncertainty briefly.",
    "Keep replies to 2–4 sentences and close with a short follow-up suggestion.",
    `Write in ${lang} style when the user requests it.`,
  ].join(" ");
}

export class TourGuideAgent {
  private agent: Agent<TourAgentContext>;
  private model: string;
  private static instance: TourGuideAgent | null = null;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required to use TourGuideAgent.");
    }
    setDefaultOpenAIKey(apiKey);
    this.model = opts?.model ?? process.env.GUIDE_MODEL ?? "gpt-4o-mini";
    this.agent = new Agent<TourAgentContext>({
      name: "Wei Jie Tour Companion",
      model: this.model,
      instructions: (runCtx: { context?: TourAgentContext }) =>
        buildSystemPrompt({
          placeName: runCtx.context?.placeName,
          lang: runCtx.context?.lang,
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
    } = input;
    if (!query?.trim()) {
      throw new Error("Query text must be provided.");
    }

    const runTrace = {
      knowledgeLookups: [] as KnowledgeLookupTrace[],
    };

    const userContext = [
      `User query: ${query}`,
      "Use the available tools to gather facts before finalising your answer. Call the knowledge lookup first; call web search only if local notes are insufficient or stale.",
      "Respond directly to the user. Reference the knowledge entry names or sources when useful.",
    ].join("\n\n");

    let agentRun;
    try {
      agentRun = await run(this.agent, userContext, {
        context: {
          placeName,
          lang,
          minimumKnowledgeScore,
          runTrace,
        },
        maxTurns: MAX_AGENT_TURNS,
      });
    } catch (error) {
      return this.handleAgentError(error);
    }

    const rawAnswer = agentRun.finalOutput;
    const answer =
      typeof rawAnswer === "string" && rawAnswer.trim()
        ? rawAnswer.trim()
        : "Sorry, I couldn't craft a response just now.";

    const usageData =
      (
        agentRun as unknown as {
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
        agentRun as unknown as {
          newItems?: Array<{ rawItem?: any }>;
        }
      ).newItems ?? [];

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
        usedWebSearch,
        webSearchNote,
      };
    }

    return {
      answer,
      knowledgeReferences,
      usedWebSearch,
      webSearchNote,
    };
  }

  private handleAgentError(error: unknown): AgentResponse {
    if (error instanceof InputGuardrailTripwireTriggered) {
      console.warn("[TourGuideAgent] input guardrail triggered", {
        message: error.message,
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
