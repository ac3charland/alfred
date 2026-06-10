# The showboat demo tool, demonstrated by itself

*2026-06-10T19:20:22.759Z*

This repo proves behavioral changes with executable *demo docs*. This very document was built by `tools/showboat` — run `npm run demo -- verify docs/demos/showboat-demo.md` to re-execute every command below and confirm the output still matches.

The CLI reports its version:

```bash
npm run --silent demo -- --version
```

```output
0.1.0
```

Building a doc is just init / note / exec. Here we build a throwaway doc in a temp dir and print it back (with the per-run timestamp line stripped so the output is deterministic):

```bash
D="$(mktemp -d)/example.md"; npm run --silent demo -- init "$D" "Example" >/dev/null; npm run --silent demo -- note "$D" "Captured output is recorded verbatim:" >/dev/null; npm run --silent demo -- exec "$D" bash "seq 3" >/dev/null; sed "/^[*][0-9]/d" "$D"
```

````output
# Example


Captured output is recorded verbatim:

```bash
seq 3
```

```output
1
2
3
```
````

`exec` also forwards the command's exit code, so a failing step surfaces as a failure. The combined output is captured either way:

```bash
echo "stdout line"; echo "stderr line" >&2; exit 0
```

```output
stdout line
stderr line
```
