import { looksLikeHtmlDocument } from './html-document';

describe('looksLikeHtmlDocument', () => {
  it('accepts a document opening with a doctype', () => {
    expect(looksLikeHtmlDocument('<!DOCTYPE html><html><body>hi</body></html>')).toBe(true);
  });

  it('accepts a document opening with <html> and no doctype', () => {
    expect(looksLikeHtmlDocument('<html lang="en"><body>hi</body></html>')).toBe(true);
  });

  it('ignores leading whitespace before the head', () => {
    expect(looksLikeHtmlDocument('\n\n   <!doctype html><html></html>')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(looksLikeHtmlDocument('<!DoCtYpE HtMl><HTML></HTML>')).toBe(true);
  });

  it('rejects markdown', () => {
    expect(looksLikeHtmlDocument('# A spec\n\nSome prose.')).toBe(false);
  });

  it('rejects an HTML fragment that is not a whole document', () => {
    expect(looksLikeHtmlDocument('<div>a fragment</div>')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(looksLikeHtmlDocument('')).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(looksLikeHtmlDocument('   \n  ')).toBe(false);
  });

  it('rejects a document whose head sits past the sniffed window', () => {
    // The sniff only reads the first 200 chars, so a doctype buried behind a long
    // preamble is (deliberately) not a document.
    expect(looksLikeHtmlDocument(`${'x'.repeat(300)}<!doctype html>`)).toBe(false);
  });
});
