import { webSearchTool } from "@openai/agents";

// Hosted web search tool powered by OpenAI's built-in integration.
export const hostedWebSearchTool = webSearchTool({
  searchContextSize: "medium",
});
