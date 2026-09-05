# thinking-fold-omp

Fold long assistant thinking blocks in [Oh My Pi](https://github.com/can1357/oh-my-pi) (OMP) so the terminal stays readable.

While a model is reasoning you see a short live tail and a timer. When it starts answering or calling a tool, that collapses to a leftover line. Later thinking in the same turn replaces that one block — tool cards stay stacked under it. Press **Alt+T** to expand the full trace.

```text
Thinking 7s (alt+t to expand)
  checking the final branch…
  validating the result…
```

```text
Thought for 12.3s (alt+t to expand)
```

Display only. Session history, reasoning signatures, and model context are not modified.

Inspired by [`@99percentpeople/pi-thinking-fold`](https://github.com/99percentpeople/pi-extensions/tree/master/extensions/thinking-fold) for Pi. This package targets OMP's extension API and TUI instead.

## Install

Requires OMP 18.1 or later.

```bash
omp plugin install github:nguyenvinhloc1997/thinking-fold-omp
```

Local checkout:

```bash
omp plugin link /path/to/thinking-fold-omp
```

Restart OMP after install or link.

## Usage

| Action | How |
| --- | --- |
| Expand or fold thinking | `Alt+T` |
| Show current settings | `/thinking-fold` |
| Preview the last N lines (1–20) | `/thinking-fold 8` |
| Disable | `/thinking-fold off` |
| Enable | `/thinking-fold on` |

Settings persist in `~/.omp/agent/thinking-fold.json`.

`Ctrl+T` stays OMP's native hide/show. This extension does not bind that key.

## How it works

OMP's thinking renderer hook is append-only, so this extension patches `AssistantMessageComponent.updateContent` at runtime:

1. Let OMP build its native thinking Markdown on the first assistant component of the turn.
2. Identify those children via a short display marker and `Markdown.debugState()`.
3. Wrap `render(width)` so only the last N terminal rows (or the leftover label) are shown.
4. Hide thinking on post-tool assistant segments OMP creates after each tool, and replace the first block's tail instead.

If the public component API is missing, the extension disables itself and leaves native rendering alone. The patch is reference-counted and restored on session shutdown.

## Development

```bash
bun test
```

## License

MIT
