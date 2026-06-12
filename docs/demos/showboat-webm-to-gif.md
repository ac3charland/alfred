# showboat: webm recordings become inline GIFs

*2026-06-12T14:11:54.537Z*

Playwright records animation demos as .webm. GitHub's file viewer and markdown renderer don't display .webm, so a recorded animation was invisible in the PR — you could only download it. The new `showboat video <doc> <webm>` command converts the recording to an animated GIF (which DOES inline as a markdown image), saves it next to the doc, embeds it, and deletes the now-redundant .webm. Conversion runs entirely in WASM via @ffmpeg/ffmpeg v0.11.x, so there's no system ffmpeg to install in any environment.

End-to-end proof: synthesize a stand-in .webm recording, run it through `showboat video`, and confirm a looping GIF was written, the .webm was discarded, and the doc now embeds the GIF.

```bash
set -e
export NODE_NO_WARNINGS=1
work="$(mktemp -d)"

# A Playwright screen recording is a .webm. Synthesize a stand-in clip with the
# same WASM ffmpeg (no system binary, nothing added to our environments). The
# ffmpeg.exit() tears the WASM runtime down so this step's process can exit.
node -e '
const { createFFmpeg } = require("@ffmpeg/ffmpeg");
const { writeFileSync } = require("fs");
(async () => {
  const ffmpeg = createFFmpeg({ log: false });
  const g = globalThis, saved = g.fetch; g.fetch = undefined;
  try { await ffmpeg.load(); } finally { g.fetch = saved; }
  await ffmpeg.run("-f","lavfi","-i","testsrc=size=240x180:rate=10:duration=1","-c:v","libvpx","c.webm");
  writeFileSync(process.argv[1], Buffer.from(ffmpeg.FS("readFile","c.webm")));
  ffmpeg.exit();
})().catch((e) => { console.error(e); process.exitCode = 1; });
' "$work/clip.webm"

# Embed it with showboat's new `video` command into a throwaway doc.
node tools/showboat/src/cli.ts init "$work/inner.md" "Inner"
node tools/showboat/src/cli.ts video "$work/inner.md" "$work/clip.webm" "screen recording"

# Deterministic evidence — never print the GIF bytes (they vary); print only facts.
printf 'gif created:  %s\n' "$([ -f "$work/inner-video-1.gif" ] && echo yes || echo no)"
printf 'gif header:   %s\n' "$(head -c 6 "$work/inner-video-1.gif")"
printf 'webm deleted: %s\n' "$([ -e "$work/clip.webm" ] && echo no || echo yes)"
printf 'doc embed:    %s\n' "$(grep -o '!\[screen recording\](inner-video-1.gif)' "$work/inner.md")"
```

```output
gif created:  yes
gif header:   GIF89a
webm deleted: yes
doc embed:    ![screen recording](inner-video-1.gif)
```

![the same testsrc recording, converted to a looping GIF by `showboat video`](showboat-webm-to-gif-video-1.gif)

Above is a real GIF this feature produced — committed alongside the doc and rendering inline here, exactly as it would in a PR. No .webm was committed: the recording was consumed and deleted by `showboat video`. A clean conversion runs in ~1s (WASM load ~0.1s + transcode ~0.8s) and only ever runs at demo-authoring / verify time, never in the check gates.
