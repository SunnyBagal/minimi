/**
 * Wraps the real (or fake) Llm and records every text delta the writer
 * produced while a turn runs. That record is the provenance the number checks
 * use: text in the answer stream that the writer did not produce was injected
 * by the app's own code.
 */
import type { Llm, WriteInput } from '../src/core/contracts';

export class RecordingLlm implements Llm {
  private recording = false;
  private written = '';

  constructor(private readonly inner: Llm) {}

  /** Starts a fresh record for the next turn. */
  startTurn(): void {
    this.recording = true;
    this.written = '';
  }

  /** Stops recording and returns everything the writer produced since `startTurn`. */
  endTurn(): string {
    this.recording = false;
    return this.written;
  }

  route(input: Parameters<Llm['route']>[0]): ReturnType<Llm['route']> {
    return this.inner.route(input);
  }

  extractClaims(input: Parameters<Llm['extractClaims']>[0]): ReturnType<Llm['extractClaims']> {
    return this.inner.extractClaims(input);
  }

  judge(input: Parameters<Llm['judge']>[0]): ReturnType<Llm['judge']> {
    return this.inner.judge(input);
  }

  async *write(input: WriteInput, signal?: AbortSignal): AsyncIterable<string> {
    for await (const delta of this.inner.write(input, signal)) {
      if (this.recording) this.written += delta;
      yield delta;
    }
  }
}
