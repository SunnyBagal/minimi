/**
 * The Llm port on the AI SDK. This is the one file in src/core that may import
 * `ai` or `@ai-sdk/*`.
 *
 * Lane 0 version: route() always plans plain chat and write() streams `chat`
 * mode. Everything else throws NotImplemented until Lane 4 extends this file.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, type ModelMessage } from 'ai';
import type { AgentConfig, Llm, RouterPlan, Turn, WriteInput } from '../contracts';

export class NotImplemented extends Error {
  override readonly name = 'NotImplemented';

  constructor(what: string) {
    super(`${what} is not implemented yet. Lane 4 builds it.`);
  }
}

const CHAT_INSTRUCTIONS = 'You are a helpful assistant. Answer plainly and briefly.';

/**
 * Earlier turns as model messages, oldest first. Empty turns are dropped, and
 * so are assistant turns ahead of the first user turn, because the provider
 * expects a conversation to open with the user.
 */
function toMessages(recent: Turn[], message: string): ModelMessage[] {
  const history = recent.filter((turn) => turn.content.trim() !== '');
  const firstUser = history.findIndex((turn) => turn.role === 'user');
  const kept = firstUser === -1 ? [] : history.slice(firstUser);
  return [...kept.map((turn): ModelMessage => ({ role: turn.role, content: turn.content })), { role: 'user', content: message }];
}

export function createAiSdkLlm(apiKey: string, config: AgentConfig): Llm {
  // Explicit provider with an explicit key: a model object, never a bare
  // "provider/model" string, so no gateway key is involved.
  const anthropic = createAnthropic({ apiKey });

  return {
    async route(): Promise<RouterPlan> {
      return {
        intent: 'chat',
        timeRef: { kind: 'none' },
        timeText: null,
        topic: null,
        entities: [],
        queries: [],
        refersToPrevious: false,
        wantsNews: false,
      };
    },

    async extractClaims() {
      throw new NotImplemented('extractClaims()');
    },

    async judge() {
      throw new NotImplemented('judge()');
    },

    async *write(input: WriteInput, signal?: AbortSignal): AsyncIterable<string> {
      if (input.mode !== 'chat') throw new NotImplemented(`write() in "${input.mode}" mode`);
      const result = streamText({
        model: anthropic(config.models.writer),
        instructions: CHAT_INSTRUCTIONS,
        messages: toMessages(input.recent, input.message),
        abortSignal: signal,
        timeout: { totalMs: config.deadlinesMs.turn },
        // The error is rethrown below; the SDK's default handler would also log it.
        onError: () => {},
      });
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          yield part.text;
        } else if (part.type === 'error') {
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
        }
      }
    },
  };
}
