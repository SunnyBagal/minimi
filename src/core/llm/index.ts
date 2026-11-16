// Lane 4 owns this file. The export stays: createLlm(apiKey, config).
import type { AgentConfig, Llm } from '../contracts';
import { createAiSdkLlm } from './aiSdkLlm';

export function createLlm(apiKey: string, config: AgentConfig): Llm {
  return createAiSdkLlm(apiKey, config);
}
