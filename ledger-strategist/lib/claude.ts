import Anthropic from "@anthropic-ai/sdk";

export function claudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let _client: Anthropic | null = null;
export function claude(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export const CLAUDE_MODEL = "claude-opus-5";
