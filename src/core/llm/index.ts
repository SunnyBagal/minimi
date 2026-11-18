// Lane 4 owns this file. The export stays: createLlm(apiKey, config).
import type { AgentConfig, Llm } from '../contracts';
import { createAiSdkLlm } from './aiSdkLlm';

/** `fetch` is optional: the eval runner passes one that meters token spend. */
export function createLlm(apiKey: string, config: AgentConfig, options: { fetch?: typeof fetch } = {}): Llm {
  return createAiSdkLlm(apiKey, config, options.fetch !== undefined ? { fetch: options.fetch } : undefined);
}
