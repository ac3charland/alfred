/**
 * What the summariser says to the model, and where the post's text stops.
 *
 * Each summary kind — essay, roundup, alerts — has one system prompt and one schema, and each
 * system prompt is STATIC — the same bytes for every post of that kind — so it says nothing about
 * a particular publication and nothing that has to be recomputed. Everything that varies rides in
 * the user turn as a short metadata block followed by the post itself and its numbered links, and
 * the user turn is the same shape for every kind. That split is what makes
 * `READER_PROMPT_VERSIONS` meaningful: a kind's version is stamped on every stored summary beside
 * the kind and the model id, so a summary written under wording that has since changed can be told
 * apart from one written under the current wording without keeping the old text anywhere.
 *
 * Two things this prompt deliberately does NOT do. It never tells the model not to think or to
 * answer without reasoning: the call already sends `thinking: { type: 'disabled' }`, and such
 * lines are a documented way to make reasoning leak into the answer as tag-like text. And it
 * never asks for JSON in prose — the schema is the contract, and repeating it here would be a
 * second copy to drift.
 */
import { htmlToText, truncateAtCodePointBoundary } from '../comms/email-text';
import { type NumberedLink, numberLinks } from './links';
import {
  READER_ALERTS_SCHEMA,
  READER_ROUNDUP_SCHEMA,
  READER_SUMMARY_SCHEMA,
  type ReaderRequestSchema,
} from './schema';
import type { ReaderSummaryKind, SummaryInput } from './types';

/**
 * Each kind's wording version, stamped on every summary written under it beside the kind.
 *
 * Bump a kind's whenever its system prompt's INSTRUCTIONS or its schema change in a way that would
 * change an answer. Reformatting the metadata block or fixing a typo is not a bump; changing what
 * "novel" means is. The kinds are versioned apart, so a new roundup wording leaves every essay
 * reading as current.
 */
export const READER_PROMPT_VERSIONS: Readonly<Record<ReaderSummaryKind, number>> = {
  essay: 2,
  roundup: 1,
  alerts: 1,
};

/**
 * The `Publication:` and `Author:` a research report is summarised under. A report has neither: it
 * is not published anywhere and carries no byline, so the metadata block names what it is — a
 * document alfred's own research routine wrote for the owner — rather than leaving the model to
 * take a title or a site for a publisher. This is metadata, not instruction, so the system prompt
 * is unchanged and no version moves. A report is always summarised as an essay.
 */
export const RESEARCH_PUBLICATION = 'alfred research — a report written for the owner';
export const RESEARCH_AUTHOR = 'Claude Code research routine';

/**
 * How much of a post's text the model ever sees — about 37 000 tokens, roughly $0.08 of input at
 * Sonnet 5's list price.
 *
 * This is the pathological case, not the typical one: a normal newsletter is an order of
 * magnitude smaller. It exists because the cost of a call is overwhelmingly its input, and a
 * single 500 000-character mail-archive digest would otherwise cost more than a day of ordinary
 * reading before the daily ceiling had any chance to notice. Separate from, and smaller than,
 * `READER_TEXT_CHARS`, which bounds what is STORED: the stored text is what the extractor kept,
 * and truncating it further for the model is a cost decision, not a retention one.
 */
export const READER_MODEL_INPUT_CHARS = 150_000;

/** Everything one summarisation request carries, ready to hand to the Anthropic client. */
export interface ReaderRequest {
  system: string;
  user: string;
  schema: ReaderRequestSchema;
  /**
   * The links the user turn lists, by number — what `normalizeReaderSummary` maps the model's
   * Further reading picks back to URLs with. Only links that made it into the list: a pick of a
   * number the model was never shown a URL for is dropped like any other unknown number.
   */
  links: NumberedLink[];
}

/**
 * The essay's static system prompt: what's new, what it rests on, and the argument.
 *
 * Each kind's prompt is written as one string rather than assembled from shared parts, although
 * they overlap: every clause of one applies to every post of its kind, a reader of this file
 * should be able to see exactly what the model is told, in order, without running anything — and
 * a shared clause edited for one kind would silently re-word the others without a version bump.
 */
const ESSAY_SYSTEM_PROMPT = `You summarise newsletter posts for one person who subscribes to far more of them than they can read.

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

Further reading
- In the post text, each link is marked with a number in square brackets right after the linked words, like "the berth study [3]". The links block after the text lists each number's URL. Name links by their numbers only.
- further_reading is for the reader who might want to go to the source. Include a link only if (a) the post's argument rests on it or engages it at length — it builds on, rebuts, or quotes substantially from that piece — or (b) the post is a link roundup and that item looks genuinely worth reading in full.
- Be selective. In a roundup, pick the few items with real substance, not the list.
- Leave out passing citations, links that support a single fact or number, definitions and reference pages, homepages and product pages, the author's own earlier posts unless the argument depends on them, and the publication's chrome (subscribe, share, comments, app, author profile, the post itself), sponsors and ads.
- Most posts warrant none or a few. An empty further_reading is the common, correct answer when nothing qualifies, and always when the links block says "none".

Fields
- headline: one line, what the post is about, at most about 20 words.
- gist: at most about 90 words. The claim, plus whether this is a new take or a restatement. This is the "should I read this?" answer.
- overview.novel_ideas: up to 6 bullets, each one genuinely new idea. Empty is valid and often correct.
- overview.evidence: up to 6 bullets of the notable evidence, data or examples the post rests on. Empty if it rests on assertion alone — which is itself worth knowing.
- overview.argument: at most about 300 words, the argument in the order the post makes it. This is the one-page alternative to reading.
- overview.who_should_read: at most about 40 words. Who the full post is worth the time for, and who can stop at this summary.
- overview.further_reading: up to 10 items. link is the link's number from the links block. title names the linked piece itself, not the words the link sits on, which are often just "this" or "here". note, at most about 20 words, says what the post uses it for.`;

/**
 * The roundup's static system prompt: what's striking in the issue itself, and which of its links
 * are worth reading in full. Its Links are picked by number from the same links block the essay's
 * Further reading is.
 */
const ROUNDUP_SYSTEM_PROMPT = `You summarise link roundups — newsletter issues that are mostly a curated set of links with short commentary — for one person who subscribes to far more newsletters than they can read.

Your summary answers two questions: is there anything in the issue itself worth knowing, and which of the pieces it links to are worth reading in full. It is not a table of contents of the issue.

Summarise only the issue in front of you. Do not bring in what you know about the publication, the author, or the wider debate, except where it is needed to judge whether something is new to a well-read person in the field.

Highlights
- Concrete information or content in the issue's own text that would make a reader want to know more: a number, a result, a quote, a sharp claim, a surprising fact.
- Each highlight is one self-contained bullet that makes sense without the issue in front of you. Name the thing: the study, the product, the figure.
- Not a table of contents: not a list of the issue's sections or topics, and not a line per item. "Covers three model releases" is useless; "a 7B open model matches last year's frontier on MATH at a fortieth of the cost" is the job.
- If nothing in the issue's own text stands out, the list is empty. That is a valid, honest answer.

Links
- In the issue text, each link is marked with a number in square brackets right after the linked words, like "the berth study [3]". The links block after the text lists each number's URL. Name links by their numbers only.
- Include a linked piece only if it is substantive and likely new to a well-read person in the field: original research, a primary source, a careful long-form piece, a dataset.
- Leave out a press release, a listicle, a widely covered launch, and a link whose substance the issue already fully summarises.
- Leave out the publication's chrome (subscribe, share, comments, app, author profile, the issue itself), sponsors and ads, and the author's own earlier issues.
- Be selective: the few items with real substance, not the list. An empty links list is a valid answer, and always the answer when the links block says "none".

What to ignore
- Subscription and unsubscribe boilerplate, sponsor blocks, footers, "share this post" and "restack" chrome, cross-promotions and job boards. None of it is the issue.

Paywalls
- If the issue arrives as a teaser before a subscribe wall, work only from what is visible and say so in the gist. Never guess at what is withheld.

Be concrete
- No padding, no praise, no throat-clearing, nothing about how well the issue is written.

Fields
- headline: one line, what the issue covers, at most about 20 words.
- gist: at most about 60 words. What the issue covers, and what — if anything — is worth opening it for.
- overview.highlights: up to 6 bullets, as above. Empty is valid.
- overview.links: up to 10 items. link is the link's number from the links block. title names the linked piece itself, not the words the link sits on, which are often just "this" or "here". note, at most about 20 words, says why it is worth reading in full.`;

/**
 * The Alerts static system prompt: one fixed rubric for every Alerts publication — a sale, a
 * security event, an action required, a change — and an empty list otherwise. There are no
 * per-publication criteria: the prompt stays static, and the owner picks a kind rather than
 * editing one.
 */
const ALERTS_SYSTEM_PROMPT = `You read corporate, retail and account email — promotions, store newsletters, account and service notices — for one person who only wants to know whether a message requires or rewards their attention. Almost all of this mail is noise. Your job is to find the rare message that is not.

Findings
Report a finding only when the message contains one of these, concretely:
- sale: a specific discount, offer or price on something specific — what, how much, and until when, when stated. "40% off all outerwear through Sunday" counts; "new arrivals you'll love" does not.
- security: a sign-in from a new device or place, a password or email change, a breach notice, suspicious activity, a locked or limited account.
- action: something the reader must do — renew, verify, confirm, respond, book, update a payment method — with its deadline when the message states one.
- change: a change to price, terms, privacy policy, plan or service that affects the reader.

Never a finding
- Generic promotion, product recommendations, "recommended for you", "new arrivals", brand storytelling, editorial filler, surveys and review requests, points balances with nothing expiring, and "don't miss out" urgency with no specific offer behind it.
- An empty findings list is the common and correct answer. Never stretch a message into a finding to have something to report.

Each finding
- category: one of sale, security, action, change.
- detail: one line, at most about 20 words, concrete — what, on what, by when: "40% off used outerwear, members only", "new sign-in from Lisbon on Oct 2 — reset your password if it wasn't you".
- deadline: the date or time by which to act, as the message states it, or null when it states none. Never infer one.
- At most 5 findings, one per distinct thing. Do not split one offer into several.

What to ignore
- Unsubscribe and legal boilerplate, footers, postal addresses, and tracking or preference-centre text.

Fields
- headline: one line, what the message is, at most about 15 words.
- gist: one line naming the finding or findings, or "Nothing notable" when there are none.
- overview.findings: the findings, as above. Empty when nothing qualifies.`;

/** Each kind's system prompt and the schema its answer is constrained to. */
const KIND_PROMPTS: Readonly<
  Record<ReaderSummaryKind, { system: string; schema: ReaderRequestSchema }>
> = {
  essay: { system: ESSAY_SYSTEM_PROMPT, schema: READER_SUMMARY_SCHEMA },
  roundup: { system: ROUNDUP_SYSTEM_PROMPT, schema: READER_ROUNDUP_SCHEMA },
  alerts: { system: ALERTS_SYSTEM_PROMPT, schema: READER_ALERTS_SCHEMA },
};

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
 * The post text the model reads, and the links it may pick from.
 *
 * With stored HTML the text is rebuilt from it with each candidate link numbered in place, so the
 * model judges a link by what the prose around it does with it. Without (plain-text mail, a row
 * from before the HTML was kept, one the retention sweep has emptied of it) the stored text goes
 * as it is, with no links — the stored text itself is never changed either way.
 *
 * An Alerts post is rebuilt from its HTML WITHOUT numbering: it picks no links, and a promo mail
 * is mostly long tracking URLs, so a links block would be most of its input tokens and pure noise
 * to the judgment.
 */
function modelText(post: SummaryInput): { text: string; links: NumberedLink[] } {
  if (post.html === undefined || post.html.trim() === '') return { text: post.text, links: [] };
  if (post.kind === 'alerts') return { text: htmlToText(post.html), links: [] };
  const { markedHtml, links } = numberLinks(post.html, post.canonicalUrl);
  return { text: htmlToText(markedHtml), links };
}

/**
 * Build one post's request: its kind's static system prompt, the metadata block plus the post's
 * text and its numbered links, and its kind's schema the answer is constrained to.
 *
 * `READER_MODEL_INPUT_CHARS` bounds the text and the links list together, the text first: it is
 * capped on a code-point boundary — cutting mid-pair would put a lone surrogate on the wire, which
 * serialises to a replacement glyph and can fail JSON encoding outright — and the list then takes
 * whole lines while they fit. A list that fits no line reads "none", like a post with no links.
 */
export function buildReaderRequest(post: SummaryInput): ReaderRequest {
  const body = modelText(post);
  const text = truncateAtCodePointBoundary(body.text, READER_MODEL_INPUT_CHARS);

  let room = READER_MODEL_INPUT_CHARS - text.length;
  const lines: string[] = [];
  const links: NumberedLink[] = [];
  for (const link of body.links) {
    const line = `[${String(link.n)}] ${link.url}`;
    // The newline in front of each line counts too.
    if (line.length + 1 > room) break;
    room -= line.length + 1;
    lines.push(line);
    links.push(link);
  }

  const { system, schema } = KIND_PROMPTS[post.kind];
  return {
    system,
    user:
      `${metadataBlock(post)}\n\n--- post text ---\n${text}\n\n` +
      `--- links ---\n${lines.length === 0 ? 'none' : lines.join('\n')}`,
    schema,
    links,
  };
}
