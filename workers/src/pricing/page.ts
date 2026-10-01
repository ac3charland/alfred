/**
 * The pricing page parser: Anthropic's public pricing page, served as markdown, turned into the
 * per-model rates alfred prices recorded sessions with.
 *
 * A pure function of the markdown and the set of model ids already in the price history. It is
 * deliberately strict — the page is someone else's document and can change shape without notice,
 * so anything that does not look exactly like the table it was written against is REJECTED, and a
 * rejection changes nothing downstream. Wrong rates silently priced into the history would be
 * worse than no new rates at all.
 */

/** One model's rates, in USD per million tokens — the keys the price history stores. */
export interface ModelRates {
  /** The cleaned display name, e.g. `Claude Opus 5.5`. */
  name: string;
  /** Base input tokens. */
  in: number;
  /** Cache writes with the 5-minute lifetime. */
  cw5m: number;
  /** Cache writes with the 1-hour lifetime. */
  cw1h: number;
  /** Cache hits and refreshes. */
  read: number;
  /** Output tokens. */
  out: number;
}

/** Every priced model, keyed by id, e.g. `claude-opus-5-5`. */
export type Rates = Record<string, ModelRates>;

/** Why a fetch was refused, as a short human reason the log line quotes. */
export class ParseError {
  readonly reason: string;

  constructor(reason: string) {
    this.reason = reason;
  }
}

/** The model table's header row, cell by cell. Every other table on the page has a different one. */
const HEADER = [
  'Model',
  'Base input tokens',
  '5m cache writes',
  '1h cache writes',
  'Cache hits and refreshes',
  'Output tokens',
];

/** Fewer model rows than this is a page that changed shape, not a short price list. */
const MIN_ROWS = 5;

const PRICE_CELL = /^\$(\d+(?:\.\d+)?) \/ MTok$/;
const SEPARATOR_CELL = /^:?-+:?$/;
const FOOTNOTE = /<sup>.*?<\/sup>/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const PARENTHETICAL = /\([^)]*\)/g;

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const isRow = (line: string): boolean => line.trim().startsWith('|');

/** The display name of a model cell: footnotes, link targets and parentheticals removed. */
function cleanName(cell: string): string {
  return cell
    .replaceAll(FOOTNOTE, '')
    .replaceAll(LINK, '$1')
    .replaceAll(PARENTHETICAL, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** `Claude Opus 5.5` becomes `claude-opus-5-5`. */
const idOf = (name: string): string => name.toLowerCase().replaceAll(/[\s.]+/g, '-');

/** A price cell's number, or NaN when it is not exactly `$n / MTok` once footnotes go. */
function parsePrice(cell: string): number {
  const match = PRICE_CELL.exec(cell.replaceAll(FOOTNOTE, '').trim());
  return Number.parseFloat(match?.[1] ?? '');
}

/** One table row's rates, or the reason it cannot be trusted. */
function parseRow(row: string[]): { id: string; rates: ModelRates } | ParseError {
  const [modelCell = '', ...priceCells] = row;
  const name = cleanName(modelCell);
  if (row.length !== HEADER.length || name === '') {
    return new ParseError(`malformed row: ${row.join(' | ')}`);
  }

  const prices = priceCells.map((cell) => parsePrice(cell));
  if (prices.some((price) => Number.isNaN(price))) {
    const bad = priceCells[prices.findIndex((price) => Number.isNaN(price))] ?? '';
    return new ParseError(`malformed price: ${name}: ${bad}`);
  }
  const [input = Number.NaN, cw5m = Number.NaN, cw1h = Number.NaN] = prices;
  const [read = Number.NaN, out = Number.NaN] = prices.slice(3);

  // Cache reads are the cheapest thing, a 5-minute write costs more than plain input, an hour
  // costs more again, and output outprices input. A table that breaks this has its columns
  // shifted or swapped, whatever its cells look like.
  if (!(read < input && input < cw5m && cw5m < cw1h && input < out)) {
    return new ParseError(`ordering violated: ${name}`);
  }

  return { id: idOf(name), rates: { name, in: input, cw5m, cw1h, read, out } };
}

/**
 * Parse the model table out of the pricing page's markdown.
 *
 * `known` is the set of model ids in the latest price history: a fetch that has lost more than
 * half of them is a page that stopped listing what it used to, and is rejected rather than
 * trusted. An empty `known` (no history yet) never trips that rule.
 */
export function parsePricingPage(markdown: string, known: Set<string>): Rates | ParseError {
  const lines = markdown.split('\n');
  const header = lines.findIndex(
    (line) =>
      isRow(line) &&
      cells(line).length === HEADER.length &&
      cells(line).every((cell, index) => cell === HEADER[index]),
  );
  if (header === -1) return new ParseError('header not found');

  // The table is the run of pipe rows after the header; its second line is the `---` separator.
  const body: string[][] = [];
  for (const line of lines.slice(header + 1)) {
    if (!isRow(line)) break;
    const row = cells(line);
    if (row.every((cell) => SEPARATOR_CELL.test(cell))) continue;
    body.push(row);
  }

  const rates: Rates = {};
  for (const row of body) {
    const parsed = parseRow(row);
    if (parsed instanceof ParseError) return parsed;
    if (parsed.id in rates) return new ParseError(`duplicate model: ${parsed.rates.name}`);
    rates[parsed.id] = parsed.rates;
  }

  const count = Object.keys(rates).length;
  if (count < MIN_ROWS) return new ParseError(`only ${String(count)} rows`);

  const missing = [...known].filter((id) => !(id in rates)).length;
  if (missing * 2 > known.size) {
    return new ParseError(`${String(missing)} of ${String(known.size)} known models missing`);
  }

  return rates;
}
