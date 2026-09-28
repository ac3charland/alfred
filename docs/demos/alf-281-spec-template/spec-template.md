---
branch: claude/alf-281-refinement-skill-uk6lg7
---

# ALF-281: every spec opens with a brief, then a fold, then the implementer's detail

*2026-09-28T15:40:26.489Z*

Refinement sessions now copy `.claude/skills/refinement/assets/spec-template.html`. The template splits every story and epic spec at a fold. Above it is **the brief**: the change in one sentence, the decisions the human must see (each marked open, proposed or settled), and plates of everything they will see. Below it is **the working detail** for the implementer. It ships one house stylesheet, so no session hand-writes CSS any more.

To prove the template carries a real spec, `alf-268-brief.html` (in this folder) rebuilds ALF-268 (unify PR-ratio repos with projects) in it. Every shot below is rendered the way the app’s SpecView renders a spec: inside `<iframe sandbox="" srcdoc>`, with scripting off. `capture.mjs` is the harness.

## The brief, day and night, at 1280px

![](spec-template-image-1.png)

![](spec-template-image-2.png)

## The same brief on a phone (390px): margin notes and captions drop under what they explain

![](spec-template-image-3.png)

![](spec-template-image-4.png)

Neither width scrolls sideways in either edition, and the plate’s Geist loads from its raw GitHub URL inside the sandboxed frame. The capture serves that URL from the committed, byte-identical font, with the headers the real response carries (`access-control-allow-origin: *`, `application/octet-stream`, `nosniff`, checked with curl while building), because this sandbox’s browser can’t verify the egress proxy’s certificate.

```bash
node docs/demos/alf-281-spec-template/capture.mjs docs/demos/alf-281-spec-template/alf-268-brief.html - layout
```

```output
390px light  no horizontal scroll; mockup font Geist: loaded
390px dark   no horizontal scroll; mockup font Geist: loaded
1280px light  no horizontal scroll; mockup font Geist: loaded
1280px dark   no horizontal scroll; mockup font Geist: loaded
```

## The brief is a minute of reading, not ten

Today ALF-268 asks for about 1,700 words before the reviewer reaches its mockup. Rebuilt, the brief is about 150 words of prose, plus two plates and one figure, which the budget doesn’t count. The template caps it at 300.

```bash
node docs/demos/alf-281-spec-template/wordcount.mjs docs/specs/archive/ALF-268.html docs/demos/alf-281-spec-template/alf-268-brief.html
```

```output
ALF-268 today, words before its mockup: 1691
ALF-268 rebuilt, brief prose (plates and figure uncounted): 156
```

## Switchers work without script

An option or state switcher is a set of radio inputs. CSS reads the choice with `:has(:checked)`, so it still works in the app’s script-less sandbox. The switcher is labelled with the decision it settles (here D3). At rest it shows the “After” state; picking “Before” swaps the card, with scripting off.

```bash
node docs/demos/alf-281-spec-template/capture.mjs docs/demos/alf-281-spec-template/alf-268-brief.html - switcher
```

```output
switcher at rest: after shown
after picking Before (no script): before shown
```

![](spec-template-image-5.png)

## The template itself

The blank template, with a `[bracketed]` placeholder in every slot and no sample content, rendered the same way:

![](spec-template-image-6.png)

Its ids, in order: the brief, the fold, then the detail. Story-only and epic-only sections carry `data-kind`, and a session deletes the kind it isn’t writing.

```bash
grep -oE ' id="[a-z0-9-]+"' .claude/skills/refinement/assets/spec-template.html | sed -E 's/ id="(.*)"/\1/' | tr '\n' ' '; echo; grep -oE 'id="[a-z-]+" data-kind="[a-z]+"' .claude/skills/refinement/assets/spec-template.html
```

```output
brief head change revised decisions plates p1 diagram not-doing heads-up fold detail context decision-records d1 behavior contracts architecture constraints split plan ac tests demo out after-merge 
id="behavior" data-kind="story"
id="contracts" data-kind="story"
id="architecture" data-kind="epic"
id="constraints" data-kind="epic"
id="split" data-kind="epic"
id="plan" data-kind="story"
id="ac" data-kind="story"
id="tests" data-kind="story"
id="demo" data-kind="story"
```

Every section carries a `guide:` comment that gives what it holds, whether it is required, and its budget. The template is project-agnostic: apart from the `alfred` imprint, it has no ticket refs, app paths or app tokens, and no embedded data URIs. The house stylesheet (sections 1–3) stays under the ~10 KB budget.

```bash
echo "guide comments: $(grep -c 'guide:' .claude/skills/refinement/assets/spec-template.html)"; echo "ALF- / frontend/ / globals.css / data-URI hits: $(grep -cE 'ALF-|frontend/|globals\.css|;base64,' .claude/skills/refinement/assets/spec-template.html)"; echo "stylesheet sections 1-3: $(sed -n '/TEMPLATE · 1/,/TEMPLATE · 4/p' .claude/skills/refinement/assets/spec-template.html | wc -c) bytes"
```

```output
guide comments: 30
ALF- / frontend/ / globals.css / data-URI hits: 0
stylesheet sections 1-3: 9160 bytes
```

Stylesheet sections 1–3 are the settled look from the ALF-281 spec, rule for rule. Only two comments changed, dropping references to that spec’s own decision ids, which would mean something else in a new spec. The third hunk is just the range’s end marker: section 4, the per-spec plate section, starts there and is generic in the template.

```bash
sed -n '/TEMPLATE · 1/,/TEMPLATE · 4/p' docs/specs/archive/ALF-281.html > /tmp/alf-281-css; sed -n '/TEMPLATE · 1/,/TEMPLATE · 4/p' .claude/skills/refinement/assets/spec-template.html > /tmp/template-css; diff /tmp/alf-281-css /tmp/template-css; sed -n '/TEMPLATE · 1/,/TEMPLATE · 4/p' docs/demos/alf-281-spec-template/alf-268-brief.html | cmp -s - /tmp/template-css && echo 'the ALF-268 rebuild carries the same sections 1-3 byte for byte'
```

```output
4c4
<    tokens. Sections 1–4 are the template stylesheet, every D1 pick settled.
---
>    tokens. Sections 1–3 are the house stylesheet: keep them verbatim.
16c16
<   /* Ink roles (D1, "whose move"): colour says who holds the decision */
---
>   /* Ink roles ("whose move"): colour says who holds the decision */
143c143
< /* ═══ TEMPLATE · 4 · PLATE — the app's own tokens, scoped (this spec: frontend/app/globals.css,
---
> /* ═══ TEMPLATE · 4 · PLATE — the switcher, then the app's own tokens scoped to .app ═══ */
the ALF-268 rebuild carries the same sections 1-3 byte for byte
```

## The skills point at it

The refinement skill’s “What to produce” now starts from the template. It carries the fold, the filter for which decisions reach the brief, the three row states, each-fact-once, and scripting-off. The PR item is renumbered 1–2, and its Iterate rule has sessions answer review comments by id and fold them back into the spec. The epic-refinement skill copies the same template. The repo-setup README copies the whole `refinement/` folder, `assets/` included. With `assets/` present, `compound-toc` requires a Contents section, and the skill now has one:

```bash
npm run -s lint:skills -w tools/skill-lint -- "$PWD/.claude/skills/refinement" "$PWD/.claude/skills/epic-refinement" 2>&1 | tail -1
```

```output
skill-lint: 2 skill(s), 0 error(s), 0 warning(s).
```

## Confirmed while building

The spec asked whether a row’s `#dN` link scrolls inside SpecView’s `sandbox="" srcdoc` frame. It doesn’t. The fragment resolves against the parent page’s URL, so clicking it navigates the frame to the app route instead of the record. Existing specs have the same problem. Injecting `<base href="about:srcdoc">` into the snapshot fixes it. That is an app change, out of scope here:

```bash
node docs/demos/alf-281-spec-template/capture.mjs docs/demos/alf-281-spec-template/alf-268-brief.html - jump
```

```output
#d2 click, as written: frame at https://alfred.test/code#d2, not scrolled
#d2 click, with <base href="about:srcdoc">: frame at about:srcdoc#d2, scrolled to the record
```
