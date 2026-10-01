/**
 * What the summariser says to the model, and where the post's text stops.
 *
 * The system prompt is STATIC — the same bytes for every post — so it says nothing about a
 * particular publication and nothing that has to be recomputed. Everything that varies rides in
 * the user turn as a short metadata block followed by the post itself. That split is what makes
 * `READER_PROMPT_VERSION` meaningful: it is stamped on every stored summary beside the model id,
 * so a summary written under wording that has since changed can be told apart from one written
 * under the current wording without keeping the old text anywhere.
 *
 * Two things this prompt deliberately does NOT do. It never tells the model not to think or to
 * answer without reasoning: the call already sends `thinking: { type: 'disabled' }`, and such
 * lines are a documented way to make reasoning leak into the answer as tag-like text. And it
 * never asks for JSON in prose — the schema is the contract, and repeating it here would be a
 * second copy to drift.
 */
import { htmlToText, truncateAtCodePointBoundary } from '../comms/email-text';
import { type NumberedLink, numberLinks } from './links';
import { READER_SUMMARY_SCHEMA, type ReaderSummarySchema } from './schema';
import type { SummaryInput } from './types';

/**
 * The wording's version, stamped on every summary written under it.
 *
 * Bump it whenever the system prompt's INSTRUCTIONS change in a way that would change an answer.
 * Reformatting the metadata block or fixing a typo is not a bump; changing what "novel" means is.
 */
export const READER_PROMPT_VERSION = 2;

/**
 * How much of a post's text the model ever sees — about 37 000 tokens, roughly $0.08 of input at
 * Sonnet 5's list price.
 *
 * This is the pathological case, not the typical one: a normal newsletter is an order of
 * magnitude smaller. It exists because the cost of a call is overwhelmingly its input, and a
 * single 500 000-character mail-archive digest would otherwise cost more than a day of ordinary
 * reading before the daily ceiling had any chance to notice. Separate from, and smaller than,
 * `READER_TEXT_CHARS`, which bounds what is STORED: the stored text is what the extractor kept,
 * and truncating it further for the model is a cost decision, not a retention one. It bounds the
 * post's text and its links block together, text first.
 */
export const READER_MODEL_INPUT_CHARS = 150_000;

/** Everything one summarisation request carries, ready to hand to the Anthropic client. */
export interface ReaderRequest {
  system: string;
  user: string;
  schema: ReaderSummarySchema;
  /** The links the user turn actually lists — the only numbers a further-reading pick may use. */
  links: NumberedLink[];
}

/**
 * The static system prompt.
 *
 * Written as one string rather than assembled from parts because there is nothing to assemble —
 * every clause applies to every post — and because a reader of this file should be able to see
 * exactly what the model is told, in order, without running anything.
 */
const SYSTEM_PROMPT = `You summarise newsletter posts for one person who subscribes to far more of them than they can read.

Your summary is how they decide WHAT TO READ. It is not a replacement for reading the post, and it is not a review. Someone finishing your summary should know what the post claims, what it rests on, and whether their own hour is worth spending on the full thing.

Summarise only the post in front of you. Do not bring in what you know about the publication, the author, or the wider debate, except where it is needed to judge whether an idea is new.

What "novel" means
- New against what a well-read person in this post's field already knows THIS SEASON — not new to a general reader, and not new since the field began.
- A post that restates the current consensus has no novel ideas, and an empty novel_ideas list is the correct, honest answer for it. Say so plainly in the gist — "a clear restatement of the standard case for X, with nothing new" — rather than promoting a familiar point to fill the list.
- A familiar idea applied to a new case, or an old claim with new numbers behind it, does count. Say which part is the new bit.

Be concrete
- Name the claim, the numbers, the named examples, the specific study or product or incident. "Discusses the trade-offs of remote work" is useless; "argues 3-day hybrid costs more than either pole, using Nielsen's 2026 seat-utilisation figures" is the job.
- No padding, no praise, no throat-clearing, no "the author thoughtfully explores". Nothing about how well it is written.
- Do not editorialise beyond the "should I read this?" verdict, which belongs in the gist and in who_should_read.
- If the post is thin, say it is thin. A short, blunt summary of a short, thin post is a good summary.

What to ignore
- Subscription and unsubscribe boilerplate, sponsor blocks, footers, "share this post" and "restack" chrome, cross-promotions, and digests of other people's comments. None of it is the post.
- If what is left after ignoring all that is nearly nothing, say so in the gist rather than summarising the chrome.

Paywalls
- Many posts arrive as a teaser: an opening section, then a subscribe wall. Summarise it as a teaser. The gist says what is visible and what is behind the wall; the overview covers only what is actually present. Never guess at the withheld argument.

Fields
- headline: one line, what the post is about, at most about 20 words.
- gist: at most about 90 words. The claim, plus whether this is a new take or a restatement. This is the "should I read this?" answer.
- overview.novel_ideas: up to 6 bullets, each one genuinely new idea. Empty is valid and often correct.
- overview.evidence: up to 6 bullets of the notable evidence, data or examples the post rests on. Empty if it rests on assertion alone — which is itself worth knowing.
- overview.argument: at most about 300 words, the argument in the order the post makes it. This is the one-page alternative to reading.
- overview.who_should_read: at most about 40 words. Who the full post is worth the time for, and who can stop at this summary.
- overview.further_reading: the linked sources worth going to, described below.

Further reading
- The post's text marks each link it makes with a number in brackets, like [3], right after the linked words, and the links block after the text lists those numbers with their addresses. The addresses are often opaque redirect wrappers, so judge each link by what the surrounding prose does with it.
- further_reading is for the reader who might want to go to the source. Include a link only if (a) the post's argument rests on it or engages it at length — it builds on it, rebuts it, or quotes substantially from that piece — or (b) the post is a link roundup and that item looks genuinely worth reading in full.
- Be selective. In a roundup, pick the few items with real substance, not the list.
- Leave out passing citations, links that support a single fact or number, definitions and reference pages, homepages and product pages, the author's own earlier posts unless the argument depends on them, and the publication's chrome (subscribe, share, comments, app, author profile, the post itself), sponsors and ads.
- Refer to links only by their numbers, in the link field. title names the linked piece, not the anchor text, which is often "this" or "here". note, at most about 20 words, says what the post uses it for.
- Up to 10 items, but most posts warrant none or a few. Empty is the right answer when nothing qualifies, and always when the links block says "none".`;

/**
 * The metadata block that opens the user turn.
 *
 * Fixed keys on fixed lines, so the model can find the title and date without hunting, and so a
 * post whose HTML lost its own headline still arrives with one. The date is the reception date,
 * which is what "this season" in the system prompt is measured against.
 */
function metadataBlock(post: SummaryInput): string {
  return [
    `Publication: ${post.publication}`,
    `Author: ${post.author ?? 'unknown'}`,
    `Title: ${post.title}`,
    `Date: ${post.receivedAt}`,
    `Word count: ${String(post.wordCount)}`,
  ].join('\n');
}

/**
 * The post's text as the model reads it — with each candidate link's number after its words when
 * the post has HTML — plus the links that text numbers. A post with no HTML, or none of whose
 * anchors is a candidate, is sent its stored text exactly.
 */
function markedText(post: SummaryInput): { text: string; links: NumberedLink[] } {
  if (post.html === undefined) return { text: post.text, links: [] };
  const { markedHtml, links } = numberLinks(post.html, post.canonicalUrl);
  return links.length === 0 ? { text: post.text, links } : { text: htmlToText(markedHtml), links };
}

/**
 * Build one post's request: the static system prompt, the metadata block plus the post's text and
 * its links block, and the schema the answer is constrained to.
 *
 * `inputChars` (`READER_MODEL_INPUT_CHARS`, overridable for tests) bounds the text and the links
 * block together. The text is cut first, on a code-point boundary — cutting mid-pair would put a
 * lone surrogate on the wire, which serialises to a replacement glyph and can fail JSON encoding
 * outright. Whatever room is left takes the list a whole line at a time, so no address is ever
 * half-sent; a link whose line does not fit is not offered, and the answer may not pick it.
 */
export function buildReaderRequest(
  post: SummaryInput,
  inputChars: number = READER_MODEL_INPUT_CHARS,
): ReaderRequest {
  const marked = markedText(post);
  const text = truncateAtCodePointBoundary(marked.text, inputChars);

  let room = inputChars - text.length;
  const links: NumberedLink[] = [];
  for (const link of marked.links) {
    const line = `[${String(link.n)}] ${link.url}`;
    if (line.length + 1 > room) break;
    room -= line.length + 1;
    links.push(link);
  }
  const block =
    links.length === 0 ? 'none' : links.map((link) => `[${String(link.n)}] ${link.url}`).join('\n');

  return {
    system: SYSTEM_PROMPT,
    user: `${metadataBlock(post)}\n\n--- post text ---\n${text}\n\n--- links ---\n${block}`,
    schema: READER_SUMMARY_SCHEMA,
    links,
  };
}
