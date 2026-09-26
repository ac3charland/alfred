import { cn } from '@/lib/utils';

/**
 * The rendered page body's prose and its four link treatments. A page's own markdown is the
 * content, so it reads at full contrast with a comfortable measure; the link treatments follow the
 * wiki's link table — an in-app page link is violet and underlined, anything bound for GitHub or
 * the open web adds ↗, and a link to a page the snapshot doesn't hold is muted and dotted.
 */

/** The prose container. Headings sit under the sticky shell with room to spare on a hash scroll. */
export const wikiProseClass = cn(
  'text-[15px] leading-relaxed text-foreground [overflow-wrap:anywhere]',
  '[&_:is(h1,h2,h3,h4,h5,h6)]:scroll-mt-20 [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold',
  '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:font-serif [&_h1]:text-2xl [&_h1]:font-normal',
  '[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-normal',
  '[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-base',
  '[&_h4]:mb-1 [&_h4]:mt-4 [&_h4]:text-sm',
  '[&>:first-child]:mt-0',
  '[&_p]:my-3',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1',
  '[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-accent-violet/40',
  '[&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:text-[13px]',
  '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-secondary/40 [&_pre]:p-3',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_hr]:my-6 [&_hr]:border-border',
  '[&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto [&_table]:text-sm',
  '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
);

/**
 * A live link — a page in the snapshot, a heading on this one, GitHub, the open web: violet and
 * underlined. An outbound one adds ↗ rather than a second colour.
 */
export const wikiLinkClass =
  'text-accent-violet underline decoration-accent-violet/50 underline-offset-2 hover:decoration-accent-violet';

/** The ↗ after an outbound link. */
export const outboundMarkClass = 'ml-0.5 inline-block text-[0.8em] no-underline';

/** A link with nowhere to go: muted, dotted, not a link. */
export const brokenLinkClass =
  'cursor-help text-muted-foreground underline decoration-dotted underline-offset-2';
