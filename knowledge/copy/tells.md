# Tells

A tell is a pattern that survives in a draft because it was cheap to produce, not because it carries meaning. The catalogue below is a flag list. It is never a ban list, and it is never evidence of who wrote a text (see the note in [INDEX.md](INDEX.md)).

## The deletion test

Every flagged word gets one test before anything is changed.

Delete the word and read the sentence again. When the meaning is unchanged, the word was doing no work and stays deleted. When the meaning is lost or the sentence stops being true, the word was doing work and stays, and the line that keeps it records why.

The test settles the whole catalogue. A word on the flag list that survives the test is correct usage. A word not on the list that fails the test is still filler.

## Flag list

Measured. A study of more than 15 million PubMed abstracts from 2010 to 2024 found 319 excess style words in 2024, a jump from earlier years where excess vocabulary had been mostly content nouns. Named examples include *delves*, *showcasing*, *underscores*, *potential*, *findings* and *crucial* (https://arxiv.org/abs/2406.07016).

The practical list, drawn from that study and from the catalogued inventory at https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing:

*additionally, align with, boasts, bolstered, crucial, deep dive, delve, delves, emphasizing, enduring, enhance, ensuring, fostering, garner, highlight, highlighting, interplay, intricate, key, landscape, meticulous, pivotal, robust, seamless, showcase, showcasing, tapestry, testament, underscore, underscores, valuable, vibrant.*

Promotional variants of the same habit: *groundbreaking, renowned, nestled, in the heart of, rich, profound, diverse array, commitment to.*

## Pattern classes

Six classes, each with a search that returns a count. The searches use the regular expression syntax of ripgrep and are run case-insensitively over the text under work.

**Copula avoidance.** A plain *is* or *has* replaced by a verb that claims more than it says.

```
\b(serves?|served|stands?|stood|functions?|operates?|acts?)\s+as\b
\b(boasts|represents|embodies|exemplifies|epitomi[sz]es|showcases)\b
```

Rewrite each hit to *is*, *has* or the concrete verb, unless the verb is literally true: a function that serves a request serves it.

**Trailing participial impact clause.** A comma followed by a participle that adds significance instead of information.

```
,\s+(highlighting|underscoring|emphasi[sz]ing|reflecting|symboli[sz]ing|showcasing|cementing|solidifying|ensuring|marking|contributing|fostering|cultivating|demonstrating|signal+ing)\b
```

The clause is almost always deletable whole. What is left is the sentence that was being written.

**Negative parallelism.** Definition by contrast with something nobody claimed.

```
\bnot\s+(only|just|merely|simply)\b
\bis\s+not\s+[^.,;]{1,60},\s+it\s+is\b
\brather\s+than\b
```

*Rather than* is often correct and is flagged, not banned. The first two forms rarely survive the deletion test: state the positive claim and stop.

**Vague attribution.** Consensus invented so a claim can be made without carrying it.

```
\b(experts?|observers?|critics?|analysts?|researchers?|industry\s+reports?|several\s+sources|some|many)\s+(say|says|argue|argues|note|notes|suggest|suggests|believe|believes|have\s+(cited|noted|argued))\b
```

Replace with the named source and its date, or delete the claim.

**Undue significance.** Importance asserted where it was not shown.

```
\b(testament|pivotal|crucial|vital|cornerstone|indelible|turning\s+point|paradigm|evolving\s+landscape|underscores?|deeply\s+rooted|rich\s+tapestry)\b
```

**Filler and inflation.** Words that lengthen a sentence without changing it.

```
\b(you\s+can|there\s+(is|are|was|were)|in\s+order\s+to|going\s+forward|utili[sz]e|leverage|facilitate|delve|delves|delving)\b
```

## Structural tells

These are formatting habits, and a published style rule usually already forbids each one.

- Title case in headings. Sentence case instead, and no period at the end of a heading (Microsoft style guide, https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice).
- Bold scattered mid paragraph. Bold marks a UI label or a term being defined, nothing else.
- A heading over a very short body. Convention: fewer than five lines of body under a heading means the heading is merged upward.
- A closing paragraph that restates what was already said. Delete it. The last sentence of the argument is the ending.
- A list whose items are full sentences. That was prose. Turn it back into prose, or cut each item to a fragment that earns the bullet.
- Em dashes above the cap in [measures.md](measures.md).

The em dash belongs with the structural tells for a reason. In one study, an instruction to drop markdown formatting removed headers and bullet points from model output immediately, while em dash use barely moved, because the em dash is valid prose punctuation as well as a structural marker (https://arxiv.org/html/2603.27006v1). That is why formatting is treated here as a writing-quality rule and never as a provenance signal.

## Plain word substitutions

Measured, in the sense that a published standard fixes each pair (GOV.UK A to Z style guide, https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/). The replacement column is the default; a more specific verb is always better than the generic one.

| Avoid | Use |
| --- | --- |
| utilise | use |
| leverage | use, or influence |
| facilitate | the verb for what actually happens, such as run or host |
| deliver | make, create, provide |
| deploy | use, build, put in place |
| robust | well tested, or the property actually meant |
| key | important, or name why it matters |
| foster | encourage, help |
| tackle | solve, fix, deal with |
| empower | allow, let |
| incentivise | encourage |
| initiate | start |
| streamline | simplify |
| impact (as a verb) | affect, change |
| going forward | from now on, or nothing |
| in order to | to |
