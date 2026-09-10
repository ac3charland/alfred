/**
 * The Comms module's pure domain layer: the queue rules, the derived row markers, the health
 * derivations and handle resolution. Importers take everything from this barrel, the way
 * `lib/habits` is consumed, so a rule has one import path however it is later re-filed.
 *
 * The seed builders (`./fixtures`) are deliberately NOT re-exported here — they are test data,
 * and the barrel is what application code imports.
 */
export {
  QUEUED_TIERS,
  type QueueByTier,
  type QueuedTier,
  groupByTier,
  isQueued,
  isShelved,
  queueCount,
  shelved,
} from './queue';

export {
  EXPIRY_WARNING_DAYS,
  type ExpiryMarker,
  RETENTION_DAYS,
  attachmentNotRead,
  decodeFailed,
  expiresSoon,
  isFiltered,
  isRefused,
  isUnjudged,
} from './markers';

export {
  type AccountHealth,
  CLASSIFIER_STALL_MINUTES,
  type ClassifierStall,
  accountHealth,
  classifierStalled,
} from './health';

export { normalizeHandle, resolvePerson } from './people';
