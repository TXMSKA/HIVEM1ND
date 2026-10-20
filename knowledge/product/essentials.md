# Essentials

The one file to read first when writing, reviewing or accepting work against a product document. The format of the product document, its sections and its one home per fact are in [files.md](../../files.md#product-projectsprojectproductmd); this file holds the rules for using it, the defaults and the searches. Work on one part starts from [INDEX.md](INDEX.md) instead.

## Floor

- A requirement changes only on a decision of the user, takes a new ID when it changes stage, and never reuses an ID.
- Every acceptance criterion and every floor line names something a reviewer can observe, of a kind listed under Defaults; a quality word alone, such as fast, simple or reliable, is never one.
- A behaviour enters the product only as a requirement; a request for one that no requirement holds goes through [scope](categories/scope.md#a-request-outside-the-requirements).
- A source that does not exist is recorded as missing, never filled in with a guess.
- Approval and Met follow the two sections below.

## Approval

- A part settled with the user is written into the product document only after the user's yes on its text, through `/brainstorm`.
- The run that writes the product document sets `updated` in its last step, once every part it wrote was approved. A part the user does not approve ends the run, and `updated` stays as it was.
- A seat's product document is then reviewed by the coordinator against the user's decisions, through the seat's `User decisions` note sent as [files.md](../../files.md#product-projectsprojectproductmd) sets out, and approved with the user. The seat does not wait for that review to start other work.
- A family product document, or one the coordinator writes for a project with no seat, is shown whole to the user before the run closes, and the user's yes is recorded with its date.

## Met

A requirement counts as met only as the task contract in [files.md](../../files.md#task-tasksid-slugmd) sets out: a `done` task cites its ID and every criterion has linked evidence in that task's Report. [requirement-acceptance](protocols/requirement-acceptance.md) is the check. The `met` count of `hivem1nd view` counts the `done` tasks that cite the ID, without the evidence, per [engine/README.md](../../engine/README.md#view-hivem1nd-view-v1); the protocol reports any difference between the two.

## Defaults

- Requirement line: `- <CODE>-<A|B|R>-<NN>: <what the product does>. Accepted when: <criterion>.`, with the code fixed for the product, as [files.md](../../files.md#product-projectsprojectproductmd) sets out. The view also counts a line written `- <ID> <Title>: ...`, per [engine/README.md](../../engine/README.md#view-hivem1nd-view-v1), and the searches below accept both.
- Criterion kinds: a screen state, a figure with its unit and the condition it is measured under, a file, or the output of a command, as [requirements](categories/requirements.md#requirement-lines) sets out.
- Floor line: `- Local first: <condition>`, and the same for `Privacy`, `Weak devices` and `Platforms`, each condition of a criterion kind, such as `- Weak devices: the first screen shows its content within 3 seconds on a five-year-old phone over a mobile connection.`
- Verdicts: the five of [files.md](../../files.md#verdicts); not run and not verifiable never count as pass.
- Time on a protocol step: a ceiling, not a budget; a step with nothing to act on ends as not applicable with its reason.

## Searches

The checks run from the mind folder with `git grep --no-index`, which works the same in a Unix shell and in PowerShell; `<file>` is a path inside the mind folder, such as `user/projects/<project>/product.md`. `-c` prints nothing when the count is zero.

Requirement lines in the form, the lines the view reads as requirements, and the criteria; the three counts are equal:

```sh
git grep --no-index -c -E '^- [A-Z][A-Z0-9]*-[ABR]-[0-9]{2}( [^:]+)?:' -- <file>
git grep --no-index -c -E '^[-*] +[A-Za-z][A-Za-z0-9]*-[ABR]-[0-9]+' -- <file>
git grep --no-index -c -F 'Accepted when:' -- <file>
```

Floor lines; the count is 4:

```sh
git grep --no-index -c -E '^- (Local first|Privacy|Weak devices|Platforms):' -- <file>
```

Repeated IDs; each prints nothing when every ID appears once:

```sh
git grep --no-index -h -o -E '^- [A-Z][A-Z0-9]*-[ABR]-[0-9]{2}' -- <file> | sort | uniq -d
```

```powershell
git grep --no-index -h -o -E '^- [A-Z][A-Z0-9]*-[ABR]-[0-9]{2}' -- <file> | Group-Object | Where-Object Count -gt 1
```

A count or an empty list is evidence only beside its positive control: a scratch file outside the mind holding the two lines `- APP-A-01: one. Accepted when: x.` and `- APP-B-04 Title: two. Accepted when: y.`, searched with `git -C <scratch> grep --no-index` and the same expressions, prints 2 for each of the first three counts.
