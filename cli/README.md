# Command line interface

`hivem1nd init` opens the ten-step terminal setup. `--gui` opens the same
setup in a secured local browser session, and `--resume` continues saved work.

```text
hivem1nd init [--gui] [--resume] [--language en|es]
hivem1nd evolve [--check-only]
hivem1nd check
hivem1nd pylon <repo> [--state branch|main] [--environment <name>]
hivem1nd swarm
```

Every command also accepts `--kit-path`, `--mind-path`, `--home-dir` and
`--hostname`. Run `hivem1nd --help` for the complete reference.

`hivem1nd check` writes nothing. It reports, one line each, the roles, commands
and features in the mind that are not installed for an attached agent, a missing
machine record, a newer version, a Git repository that is not a registered
project, and the unread messages and open tasks of the current project and of
the executive roles. It prints nothing when there is nothing to report, and
contacts the network only under the daily update check rule.

Human-readable summaries are the default. `--json` prints the complete result
for scripts. Evolution conflicts can be supplied with repeatable
`--conflict <path>=keep|replace` options.
