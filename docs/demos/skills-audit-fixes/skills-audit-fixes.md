---
branch: claude/skills-audit-fixes-fokhkx
---

# Skills audit: descriptions tightened under the length target

*2026-06-20T04:08:21.699Z*

Running the skills audit (`npm run audit:skills`) surfaced 12 warnings: 11 `description-tightness` warnings (frontmatter descriptions past the ~700-char soft target) and 1 `body-length` warning on `skill-creator`. This change tightens the 11 over-target descriptions back under budget while preserving each skill's distinctive trigger keywords and sibling cross-references. The remaining `skill-creator` body-length warning is left as-is: skill-lint's own docs cite it as a legitimately large skill, and warnings never fail the gate.

The audit now reports a single warning — the intentionally-retained `skill-creator` body-length — and zero errors:

```bash
npm run audit:skills 2>/dev/null | grep "skill-lint:"
```

```output
skill-lint: 33 skill(s), 0 error(s), 1 warning(s).
```

Folded frontmatter `description` length for each of the 11 tightened skills — all now comfortably under the 700-char soft target:

```node
const {readFileSync}=require("fs");
const skills=["anthropic-api","batch-commits","cloudflare-workers","data-flow","debug-animations","dnd-kit","lib-skill-forge","motion","showboat","storybook","stryker"];
for(const s of skills){
  const fm=readFileSync(`.claude/skills/${s}/SKILL.md`,"utf8").split(/^---$/m)[1];
  const lines=fm.split("\n");
  const i=lines.findIndex(l=>l.startsWith("description:"));
  const val=lines[i].slice(12).trim();
  let desc;
  if(val===">"||val==="|"||val===""){const b=[];for(let j=i+1;j<lines.length;j++){if(/^\S/.test(lines[j]))break;b.push(lines[j]);}desc=b.join(" ");}
  else desc=val;
  desc=desc.replace(/\s+/g," ").trim();
  console.log(String(desc.length).padStart(4)+"  "+s+(desc.length<700?"":"  OVER"));
}
```

```output
 650  anthropic-api
 519  batch-commits
 678  cloudflare-workers
 699  data-flow
 681  debug-animations
 698  dnd-kit
 685  lib-skill-forge
 563  motion
 681  showboat
 699  storybook
 687  stryker
```
