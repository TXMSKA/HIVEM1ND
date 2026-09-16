# Command line interface

`hivem1nd init` opens the ten-step terminal setup. `--gui` opens the same
setup in a secured local browser session, and `--resume` continues saved work.

```text
hivem1nd init [--gui] [--resume] [--language en|es]
hivem1nd evolve [--check-only]
hivem1nd pylon <repo> [--state branch|main] [--environment <name>]
hivem1nd swarm
```

Every command also accepts `--kit-path`, `--mind-path`, `--home-dir` and
`--hostname`. Run `hivem1nd --help` for the complete reference.

Human-readable summaries are the default. `--json` prints the complete result
for scripts. Evolution conflicts can be supplied with repeatable
`--conflict <path>=keep|replace` options.
