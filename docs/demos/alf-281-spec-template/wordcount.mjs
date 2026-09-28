// Counts the prose a reviewer reads before signing off: today's ALF-268 up to its mockup, and the
// same spec's brief rebuilt in the template (plates and the figure excluded — pictures are uncounted).
//
//   node wordcount.mjs <archived-spec.html> <rebuilt-brief.html>
import { readFileSync } from 'node:fs';

const words = (html) =>
  html
    .replaceAll(/<!--[\s\S]*?-->/g, ' ')
    .replaceAll(/<(style|script|svg)[\s\S]*?<\/\1>/g, ' ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/&[a-z#\d]+;/gi, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

const [todayPath, rebuiltPath] = process.argv.slice(2);
const today = readFileSync(todayPath, 'utf8');
const body = today.slice(today.indexOf('<body'));
const beforeMockup = body.slice(0, body.indexOf('id="mockup"'));

const rebuilt = readFileSync(rebuiltPath, 'utf8');
const brief = rebuilt
  .slice(rebuilt.indexOf('<section id="brief"'), rebuilt.indexOf('<div class="fold"'))
  .replace(/<section id="plates"[\s\S]*?<\/section>/, ' ')
  .replace(/<section id="diagram"[\s\S]*?<\/section>/, ' ');

console.log(`ALF-268 today, words before its mockup: ${words(beforeMockup)}`);
console.log(`ALF-268 rebuilt, brief prose (plates and figure uncounted): ${words(brief)}`);
