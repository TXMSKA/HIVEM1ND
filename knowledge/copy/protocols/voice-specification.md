name: voice-specification
purpose: Turn a voice from a set of adjectives into values and lists a reviewer can check a string against.
trigger: manual, before writing copy for a new product or section, and on any rewrite that spans surfaces
repeat: once per product, and again when the product changes what it is
inputs: the brief, the existing copy, three real strings to calibrate against
stop: a voice specification already exists and the brief does not contradict it, in which case the run ends after step 1
report: the four dimension values, the size of the word table, the sentence rules chosen, and the three calibrated samples with their scores

## Steps

1. Look for the specification that already exists.
   Task: search the project for a voice, tone or copy guide, and read it. Compare it against the brief.
   Time: 10 minutes.
   Result: either the path of the existing specification is recorded and the run ends, or it is recorded that none exists.

2. Place the voice on the four dimensions.
   Task: score the voice from 1 to 5 on each of formal against casual, serious against funny, respectful against irreverent, and matter-of-fact against enthusiastic (https://www.nngroup.com/articles/tone-of-voice-dimensions/). Write one sentence under each score saying what in the product or the audience earns it.
   Time: 20 minutes; when the brief cannot answer a dimension, record the proposal as an assumption and ask before the specification is published.
   Result: four numbers recorded, each with a sentence naming something the brief actually contains. A dimension scored without a sentence is not scored.

3. Build the word table.
   Task: write the pairs. Start from the substitution table in [tells.md](../tells.md), then add the words this product uses for its own things and the words it refuses, with a replacement for every refusal.
   Time: 30 minutes.
   Result: a table of at least fifteen rows, every row with both columns filled. A row with an empty replacement column is not a rule, and is removed or completed.

4. Fix the sentence rules.
   Task: decide and write down, with one passing example and one failing example each, whether contractions are used, which person the copy speaks in, which tense, whether questions may be headings, and how numbers and dates are written. These are conventions, and the point is that they are chosen once rather than argued per string.
   Time: 20 minutes.
   Result: each rule is one sentence with two examples. The count of rules without both examples is zero.

5. Calibrate against three real strings.
   Task: take three strings already in the product, score each against the four dimension values, and mark it on-voice or off-voice with the dimension that fails. Rewrite each off-voice string and score it again.
   Time: 20 minutes.
   Result: three strings scored, every off-voice string rewritten and rescored on-voice, and the before and after pair kept in the specification as its examples.

6. Publish the specification.
   Task: write the four values, the word table, the sentence rules and the three calibrated pairs into one file at the copy location of the project, and name that file in the project brief.
   Time: 10 minutes.
   Result: the file exists, contains all four parts, and is reachable from the brief. Later protocols read it by that path.
