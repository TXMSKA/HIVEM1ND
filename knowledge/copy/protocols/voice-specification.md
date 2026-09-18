name: voice-specification
purpose: Turn a voice from a set of adjectives into values and lists a reviewer can check a string against.
scope: a new product or section, a rewrite that spans categories, or a disagreement about how the text should sound
trigger: manual, before writing copy for a new product or section, and on any rewrite that spans surfaces
repeat: once per product, and again when the product changes what it is
inputs: the brief, the existing copy or, for a new product, the first strings drafted, three strings to calibrate against
stop: a voice specification already exists and the brief does not contradict it, in which case the run ends after step 1; a step with nothing to act on in the text at hand ends as not applicable with its reason, and evidence the tools at hand cannot produce is recorded as not verifiable while the run continues
report: the four dimension values, the size of the word table, the sentence rules chosen, and the three calibrated samples with their scores

## Steps

1. Look for the specification that already exists.
   Task: look for `docs/voice.md`, then a Voice section in the project's rules file, then any other voice, tone or copy guide, and read what is found. Compare it against the brief.
   Time: 10 minutes.
   Result: either the path of the existing specification is recorded and the run ends, or it is recorded that none exists.

2. Place the voice on the four dimensions.
   Task: score the voice from 1 to 5 on each of formal against casual, serious against funny, respectful against irreverent, and matter-of-fact against enthusiastic (https://www.nngroup.com/articles/tone-of-voice-dimensions/), starting from the closest preset in [options.md](../options.md). Write one sentence under each score saying what in the product or the audience earns it.
   Time: 20 minutes; when the brief cannot answer a dimension, record the proposal as an assumption and ask before the specification is published.
   Result: four numbers recorded, each with a sentence naming something the brief actually contains. A dimension scored without a sentence is not scored.

3. Build the word table.
   Task: write the pairs. Start from the substitution table in [tells.md](../tells.md), then add the words this product uses for its own things and the words it refuses, with a replacement for every refusal.
   Time: 30 minutes.
   Result: a table of at least fifteen rows, or one row for every term of a product that has fewer, every row with both columns filled and, in a bilingual product, the term in every language. A row with an empty replacement column is not a rule, and is removed or completed.

4. Fix the sentence rules.
   Task: pick a value for every option in [options.md](../options.md), person, length, line shape, dash policy, casing, contractions, emoji, opening and closing, register per language and claim level, then add the tense, whether questions may be headings, the locale tag of each language, and the formats of numbers, dates, currency and quotation marks, starting from the table in [essentials.md](../essentials.md#defaults). Write each with one passing example and one failing example. These are conventions, and the point is that they are chosen once rather than argued per string.
   Time: 20 minutes.
   Result: each rule is one sentence with two examples. The count of rules without both examples is zero.

5. Calibrate against three real strings.
   Task: take three strings already in the product, score each against the four dimension values, and mark it on-voice or off-voice with the dimension that fails. Rewrite each off-voice string and score it again. A new product with no strings drafts three first, a button, an error and a paragraph, and calibrates those.
   Time: 20 minutes.
   Result: three strings scored, every off-voice string rewritten and rescored on-voice, and the before and after pair kept in the specification as its examples.

6. Publish the specification.
   Task: when the pass may create the voice file, per [boundaries.md](../boundaries.md#the-voice-file), write the four values, the word table, the sentence rules, the languages and register, the one-language list and the three calibrated pairs into `docs/voice.md`, or into a Voice section of the project's rules file when the project keeps one, and name that location in the project brief when a brief exists.
   Time: 10 minutes.
   Result: the file exists, contains every part, and is reachable from the brief; or, when the pass may not create it, the same parts are in the report and the missing file is an open item. Later protocols and [humanize](../features/humanize.md) read it by that path.
