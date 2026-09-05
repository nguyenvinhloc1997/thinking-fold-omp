# thinking-fold-omp

This plugin moved into [better-tui-omp](https://github.com/nguyenvinhloc1997/better-tui-omp).

Install that instead. Do not run both — they patch the same TUI component.

```bash
omp plugin uninstall thinking-fold-omp
omp plugin install github:nguyenvinhloc1997/better-tui-omp
```

Local checkout:

```bash
omp plugin uninstall thinking-fold-omp
omp plugin link /path/to/better-tui-omp
```

Restart OMP after the switch. Thinking-fold settings in `~/.omp/agent/thinking-fold.json` still apply.
