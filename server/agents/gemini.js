/**
 * Google Gemini provider (official @google/genai SDK). Used when GEMINI_API_KEY is
 * set and no Anthropic key is configured (or AI_PROVIDER=gemini). Same agent
 * contracts as the Claude path: structured JSON for planner/verifier, a
 * function-calling loop for the negotiator.
 */
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import { config } from '../config.js';

let client;
export function gemini() {
  // 60s cap per call: a slow model falls back to the heuristic agent instead of hanging the flow.
  client ??= new GoogleGenAI({ apiKey: config.ai.geminiKey, httpOptions: { timeout: 60_000 } });
  return client;
}
/** Test hook: inject a client (e.g. one with a mocked fetch). */
export function setGeminiClient(c) {
  client = c;
}

/**
 * generateContent with resilience for free-tier keys (429 / 5xx):
 *  - per-minute rate limit / overload / timeout (429, 500, 503, 504) → wait (server-hinted delay) and retry
 *  - daily quota exhausted or model keeps failing → move to the next model in
 *    GEMINI_MODEL + GEMINI_FALLBACK_MODELS (each model has its own free quota)
 */
async function generate(params, attempts = 3) {
  const models = [...new Set([params.model, ...config.ai.geminiFallbackModels])];
  let lastErr;
  for (const model of models) {
    for (let i = 0; i < attempts; i++) {
      try {
        return await gemini().models.generateContent({ ...params, model });
      } catch (e) {
        lastErr = e;
        const status = e?.status;
        if (![429, 500, 503, 504].includes(status)) throw e;
        const msg = String(e.message);
        if (/per ?day|PerDay|daily/i.test(msg)) break; // daily quota gone → next model
        if (i === attempts - 1) break;
        const hinted = Number(msg.match(/retry in ([\d.]+)s/i)?.[1]);
        const waitMs = Math.min(30_000, (Number.isFinite(hinted) ? hinted * 1000 : 4000 * (i + 1)) + 500);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw lastErr;
}

export const LEVEL = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };

export function jsonSchemaOf(zodSchema) {
  const { $schema, ...schema } = z.toJSONSchema(zodSchema);
  return schema;
}

export const geminiUsage = (resp) => ({
  model: resp.modelVersion || config.ai.geminiModel,
  inputTokens: resp.usageMetadata?.promptTokenCount,
  outputTokens: resp.usageMetadata?.candidatesTokenCount,
});

function assertUsable(resp) {
  const c = resp.candidates?.[0];
  if (resp.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt: ${resp.promptFeedback.blockReason}`);
  if (!c) throw new Error('Gemini returned no candidates');
  if (c.finishReason && !['STOP', 'MAX_TOKENS'].includes(c.finishReason)) throw new Error(`Gemini stopped: ${c.finishReason}`);
  if (c.finishReason === 'MAX_TOKENS') throw new Error('Gemini hit max output tokens before finishing');
  return resp;
}

/** One structured-output call; returns the zod-validated object. */
export async function geminiJSON({ system, parts, schema, level = 'low' }) {
  const resp = assertUsable(
    await generate({
      model: config.ai.geminiModel,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchemaOf(schema),
        thinkingConfig: { thinkingLevel: LEVEL[level] },
      },
    }),
  );
  const parsed = schema.parse(JSON.parse(resp.text ?? ''));
  return { parsed, usage: geminiUsage(resp) };
}

/**
 * Function-calling loop. `exec(name, args)` runs a tool and returns a plain object.
 * Stops when `done()` is true, the model stops calling tools, or maxTurns is hit.
 */
export async function geminiToolLoop({ system, tools, exec, done, kickoff, nudge, maxTurns = 16, level = 'medium', onText }) {
  const functionDeclarations = tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema }));
  const contents = [{ role: 'user', parts: [{ text: kickoff }] }];
  const usage = [];
  for (let turn = 0; turn < maxTurns && !done(); turn++) {
    const resp = assertUsable(
      await generate({
        model: config.ai.geminiModel,
        contents,
        config: { systemInstruction: system, tools: [{ functionDeclarations }], thinkingConfig: { thinkingLevel: LEVEL[level] } },
      }),
    );
    usage.push(geminiUsage(resp));
    const content = resp.candidates[0].content;
    // Keep the model turn verbatim (incl. thought signatures) for multi-turn function calling.
    contents.push(content);
    const said = (content.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('\n').trim();
    if (said) onText?.(said);

    const calls = resp.functionCalls || [];
    if (!calls.length) {
      if (!done() && nudge) {
        contents.push({ role: 'user', parts: [{ text: nudge }] });
        continue;
      }
      break;
    }
    // All function responses go back in ONE user turn, matched by id/name.
    contents.push({
      role: 'user',
      parts: calls.map((c) => {
        let out;
        try {
          out = exec(c.name, c.args || {});
        } catch (e) {
          out = { error: e.message };
        }
        return { functionResponse: { id: c.id, name: c.name, response: out ?? {} } };
      }),
    });
  }
  return { usage };
}
