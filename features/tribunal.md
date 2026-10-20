---
name: tribunal
description: Convenes three judges, cross-examines their findings and records an evidence-backed verdict without editing code.
category: quality
---

# /tribunal

Mind: {{mind}}
Argument: [task or range]

Start: Locate in `rules.md` of the mind above.

## Panels

`/tribunal` and `/corpo` run the same steps with different judges. The third judge of each panel is the challenger of the cross-examination.

| Seat | /tribunal | /corpo |
| --- | --- | --- |
| Judge 1 | A technical judge: correctness, build, tests and code | A tech lead who reports every minor error |
| Judge 2 | An interface judge: the interface where it runs; not applicable, in one line, when the work has no interface | A project manager who asks about the most irrelevant missing feature |
| Judge 3, challenger | A demanding product owner: whether the work does what was asked and nothing else | A product owner who misunderstands the goal |
| Minor findings | Kept when evidence backs them | Every one kept, so the person decides what to ignore |

## Steps

1. Build the case file: the original request, the diff or the delivered files, the brief, the design document when the brief names one, and every claim the executor made.
2. Start the three judges of the panel in parallel, each with the full case file.
3. Cross-examine: each challenge of the challenger goes to the judge it concerns, to be answered with evidence: file and line, build output, or the behaviour where it runs.
4. Write the verdict: one row per judge, named as in the panel, each one of the verdicts of `files.md`:
   - pass: no blocking finding, and every challenge answered with evidence.
   - fail: at least one blocking finding, with its evidence.
   - not verifiable: a challenge without a verifiable answer.
   - not applicable: the interface judge on work with no interface.
   - not run: the judge could not run, with the reason.
5. Every finding carries blocking or minor, and file and line where it has them. The verdict lists the fixes for the blocking ones.
6. With a fail, create a task for the executor of the work with `/task`, its Request holding the fixes. Otherwise write the verdict as a log entry, `log/<YYYYMMDD-HHMM>-<unit>.md`.
7. Never edit code.

## End

- Stops when the verdict is written.
- Reports each row with its result, the count of blocking and minor findings, and the task id or the log path.
