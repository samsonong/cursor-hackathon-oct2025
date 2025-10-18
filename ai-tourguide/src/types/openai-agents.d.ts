declare module "@openai/agents" {
  export interface InputGuardrail {
    name: string;
    execute: (payload: unknown) => Promise<unknown>;
  }

  export interface OutputGuardrail {
    name: string;
    execute: (payload: unknown) => Promise<unknown>;
  }

  export class InputGuardrailTripwireTriggered extends Error {}
  export class OutputGuardrailTripwireTriggered extends Error {}
  export class MaxTurnsExceededError extends Error {}

  export class Agent {
    constructor(options: unknown);
  }

  export function run(
    agent: Agent,
    input: unknown,
    options?: unknown
  ): Promise<unknown>;

  export function setDefaultOpenAIKey(key: string): void;
  export function tool(definition: unknown): unknown;
  export function webSearchTool(options: unknown): unknown;
}
