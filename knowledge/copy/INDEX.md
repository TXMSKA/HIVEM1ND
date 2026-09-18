# Copy

Copy work runs as protocols. This file is the whole map. Read it, pick the two or three protocols the text in hand actually needs, and read only those.

Reading every protocol before every edit is the wrong way to use the module. It spends context on rules the edit cannot break and turns into a checklist nobody runs. A protocol that is not read is cheaper than a protocol that is skimmed.

Match the work against the second column: the words there describe a request or a diff, not a discipline. Most changes match two or three rows. When nothing matches, the change is not a copy change and no protocol applies.

| Protocol | Applies when | Purpose |
| --- | --- | --- |
| [tell-removal](protocols/tell-removal.md) | Any draft written or rewritten with a model, or any prose that reads as generated | Remove the patterns that make text read as machine-written, by deletion test and not by ban list |
| [voice-specification](protocols/voice-specification.md) | A new product or section, a rewrite across surfaces, or a disagreement about how the text should sound | Turn a voice into four recorded values and a word table a reviewer can check |
| [surface-copy](protocols/surface-copy.md) | Any user-facing string, label, error, empty state, button, onboarding step, changelog entry or reference page | Hold each string to the rules of the surface it appears on |
| [bilingual-copy](protocols/bilingual-copy.md) | Any string that ships in more than one language, and any fixed container that holds text | Write both languages together and size every container for the longer one |
| [copy-verification](protocols/copy-verification.md) | Before any copy change ships, and after every rewrite pass | Produce the numbers that show this draft improved on the one before it |

Every protocol ends in artifacts: a count, a density per thousand words, a search that returns no hits, a before and after pair, or a ratio. A step whose result is an opinion is a step that was not run.

Four topics at the module root back the protocols and are read only when a step points at them:

- [tells.md](tells.md) holds the flag list, the pattern classes with their searches, the structural tells and the plain word substitutions.
- [surfaces.md](surfaces.md) holds one checklist per surface, from product page to reference documentation.
- [measures.md](measures.md) defines every number this module reports, how it is computed and what it does not prove.
- [bilingual.md](bilingual.md) holds the expansion figures and the per-language conventions.

The command [humanize](features/humanize.md) runs the module on a text, and composes after other work in the same request.

## Measured and convention

Every rule in this module carries one of two marks.

**Measured** means a cited study or a published guideline reports it, and the figure in the text is the figure in the source. The source is named where a reader needs it.

**Convention** means the module picked a value that no source fixes. Whether to use contractions, the em dash cap, the sentence-variance threshold, any readability target, the bullet ratio and the words-per-heading floor are all conventions. A project may set them differently and stay correct, as long as it sets them once and checks against what it set.

## What the tell list is not

The tell list is a writing-quality checklist. It is never evidence of authorship.

One study tested fourteen detection systems and found them neither accurate nor reliable, with a bias toward calling text human-written (https://arxiv.org/abs/2306.15666). No count this module produces says who or what wrote a text. A high count says the text is worth another pass, and nothing else. A rule that would only be worth following to defeat a detector does not belong here.
