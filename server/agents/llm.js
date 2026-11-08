import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

let client;
export function claude() {
  client ??= new Anthropic({ apiKey: config.ai.apiKey });
  return client;
}
/** Test hook: inject a client (e.g. one with a mocked fetch). */
export function setClaudeClient(c) {
  client = c;
}

/**
 * Shared request settings for every agent call.
 * - adaptive thinking (Claude decides how much to reason)
 * - server-side refusal fallback ("default" routing) so a safety-classifier
 *   decline is retried on Anthropic's recommended fallback model instead of
 *   failing the procurement flow.
 */
export function baseParams(effort = 'medium') {
  return {
    model: config.ai.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort },
  };
}

export class RefusalError extends Error {}

export function assertUsable(resp) {
  if (resp.stop_reason === 'refusal') {
    throw new RefusalError(`Model declined: ${resp.stop_details?.category ?? 'unknown'} – ${resp.stop_details?.explanation ?? ''}`);
  }
  if (resp.stop_reason === 'max_tokens') throw new Error('Model hit max_tokens before finishing');
  return resp;
}

export const textOf = (resp) =>
  resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

export const usageOf = (resp) => ({
  model: resp.model,
  inputTokens: resp.usage?.input_tokens,
  outputTokens: resp.usage?.output_tokens,
});
