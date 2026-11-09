---
branch: claude/upgrade-haiku-sonnet-models-s6velt
---

# ALF-340: Haiku 5.5 and Sonnet 5.5 for the Worker's model calls

*2026-11-09T21:13:09.102Z*

The Worker ships `claude-haiku-5-5` as `CLASSIFIER_MODEL` (the Inbox and Comms classifiers) and `claude-sonnet-5-5` as both `READER_MODEL` and `DIGEST_MODEL`. Effort levels are unchanged: the classifier sends none, the Reader sends `medium` and the digest opener sends `low`.

Neither new model takes the old request unchanged. Haiku 5.5 runs adaptive thinking when `thinking` is omitted (Haiku 4.5 never thought unasked), and thinking counts against the classifier's 512-token `max_tokens`. Sonnet 5.5 rejects `thinking: disabled` with a 400, and its thinking-off form is `between_tools`, which every other model rejects. Every call now switches thinking off through `thinkingOff(model)` (`workers/src/thinking.ts`), so each `*_MODEL` var stays a deploy flag.

Before this change, the classifier sent `claude-haiku-4-5` with no `thinking` key, and the Reader and the digest sent `claude-sonnet-5` with `thinking: disabled`.

Below, the real `classifyJson`, `summarizePost` and `writeOpener` run against a stand-in `/v1/messages` (the SDK's own `ANTHROPIC_BASE_URL`) that prints each request body's model, thinking and effort. The model ids are read from `wrangler.toml`. The last line rolls `READER_MODEL` back to Sonnet 5 without a code change.

```bash
node --import ./workers/scripts/ts-resolve.mjs docs/demos/alf-340-haiku-sonnet-5-5/wire-requests.mts
```

```output
wrangler.toml: CLASSIFIER_MODEL=claude-haiku-5-5 READER_MODEL=claude-sonnet-5-5 DIGEST_MODEL=claude-sonnet-5-5
classifier  {"model":"claude-haiku-5-5","max_tokens":512,"thinking":{"type":"disabled"},"effort":"(omitted)"}
reader      {"model":"claude-sonnet-5-5","max_tokens":4096,"thinking":{"type":"between_tools"},"effort":"medium"}
digest      {"model":"claude-sonnet-5-5","max_tokens":400,"thinking":{"type":"between_tools"},"effort":"low"}
reader (READER_MODEL rolled back to claude-sonnet-5)  {"model":"claude-sonnet-5","max_tokens":4096,"thinking":{"type":"disabled"},"effort":"medium"}
```
