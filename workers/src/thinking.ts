/**
 * How to switch thinking off for a model. Every model call in this Worker wants a plain structured
 * answer, and on the current models an omitted `thinking` key means ADAPTIVE thinking — billed as
 * output and counted against `max_tokens`, which is how a tight call truncates silently.
 *
 * The spelling of "off" is per model, and the wrong one is a 400 on every request: Sonnet 5.5
 * rejects `disabled` and wants `between_tools`, which every other model rejects in turn. Deciding
 * it from the id keeps each `*_MODEL` var a deploy flag — rolling one back needs no code change.
 * Opus 5.5, Fable and Mythos accept neither — thinking is always on there — so for them the key is
 * left out (`undefined`) and the call runs with adaptive thinking rather than a 400 on every request.
 *
 * A fact about models, not a shared call: the call shapes stay uncoupled (see reader/summarize.ts).
 */
import type Anthropic from '@anthropic-ai/sdk';

const ALWAYS_THINKING = ['claude-opus-5-5', 'claude-fable-', 'claude-mythos-'];

export function thinkingOff(model: string): Anthropic.ThinkingConfigParam | undefined {
  if (ALWAYS_THINKING.some((prefix) => model.startsWith(prefix))) return undefined;
  return model.startsWith('claude-sonnet-5-5') ? { type: 'between_tools' } : { type: 'disabled' };
}

/** `thinkingOff` as request params: `{ thinking }`, or nothing where the model can't switch it off. */
export function thinkingOffParams(model: string): { thinking?: Anthropic.ThinkingConfigParam } {
  const thinking = thinkingOff(model);
  return thinking === undefined ? {} : { thinking };
}
