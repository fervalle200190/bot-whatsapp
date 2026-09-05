import Anthropic from "@anthropic-ai/sdk";

let cachedClient: Anthropic | undefined;

export function getAnthropicClient(apiKey: string): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}
