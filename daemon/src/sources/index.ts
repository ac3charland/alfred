import type { DaemonConfig } from '../config.ts';
import type { SourceKey } from '../contract.ts';
import { createIMessageSource } from './imessage/index.ts';
import type { Source } from './types.ts';
import { createWorkmailSource } from './workmail/index.ts';

/**
 * The source registry — the one list the daemon runs. A source appears here when its config
 * section is present AND enabled, and when the `--source` flag (if given) names it.
 *
 * Adding a source is: a config section in `config.ts`, a factory under `sources/<key>/`, and one
 * branch below. Nothing else in the daemon knows which sources exist.
 */
export function createSources(config: DaemonConfig, only?: readonly SourceKey[]): Source[] {
  const wanted = (key: SourceKey): boolean => only === undefined || only.includes(key);
  const sources: Source[] = [];

  const { imessage, workmail } = config.sources;
  if (imessage?.enabled === true && wanted('imessage')) {
    sources.push(createIMessageSource(imessage));
  }
  if (workmail?.enabled === true && wanted('workmail')) {
    sources.push(createWorkmailSource(workmail));
  }

  return sources;
}
