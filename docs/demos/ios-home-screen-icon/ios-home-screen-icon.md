---
branch: claude/gracious-bell-0i8fl5
---

# iOS home-screen shortcut icon

*2026-06-13T04:19:46.399Z*

When alfred is saved as a web-app shortcut on an iPhone home screen, iOS uses the `apple-touch-icon` link in the HTML head. This change adds `app/apple-icon.tsx` (a Next.js metadata-route handler using `ImageResponse`) and updates the auth middleware to let the icon route through without a login redirect.

```bash
curl -s http://localhost:3000/login | python3 -c "import sys,re; html=sys.stdin.read(); [print(m) for m in re.findall(r'<link[^>]*apple[^>]*>', html)]"
```

```output
<link rel="apple-touch-icon" href="/apple-icon?87b34abda0bebb1a" type="image/png" sizes="180x180"/>
```

The icon uses Liberation Serif (a metric-compatible substitute for Georgia) with `marginBottom: 34` in the flexbox container to correct for em-box descent, giving exactly 52px of dark space above and below the glyph:

![](ios-home-screen-icon-image-1.png)
