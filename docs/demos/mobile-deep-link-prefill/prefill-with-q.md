---
branch: claude/mobile-deep-link-claude-app-sb5eo9
---

# Mobile deep link prefills the Claude app composer (q param)

*2026-06-15T17:11:06.800Z*

On mobile, the Software Factory's "Open in Claude Code" links are https://claude.ai/code universal links: iOS/Android hand them off to the Claude app when it's installed, and open them in the browser otherwise — automatic fallback, no app-detection or media queries needed.

The only gap was the composer param. The web surface accepts both `prompt` and `q`, but the mobile app's universal-link composer reads only `q`, so our `prompt` value silently no-op'd in the app. Emitting `q` prefills on phone AND desktop.

```text
node --no-warnings docs/demos/mobile-deep-link-prefill/build-sample-link.mjs
```

```output
origin+path : https://claude.ai/code
q present   : true
prompt absent: true
q first line: ALF-42: Verify the webhook HMAC signature
```
