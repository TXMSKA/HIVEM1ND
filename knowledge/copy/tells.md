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

Each entry stands for its inflections: *seamless* also matches *seamlessly*, *highlight* matches *highlights*, *highlighted* and *highlighting*. The combined pattern below spells every variant out, so no reader has to guess them. A technical sense is an expected survivor of the deletion test: *key* in *translation key* or *API key* carries the meaning and stays, with that reason recorded.

## Pattern classes

Seven classes with a search that returns a count, and one read by hand. The searches are run case-insensitively over the corpus built as in [measures.md](measures.md#the-corpus), and are written so that ripgrep, PowerShell, grep with Perl syntax and JavaScript read them alike (see Running the searches below).

**Copula avoidance.** A plain *is* or *has* replaced by a verb that claims more than it says.

```
\b(serves?|served|stands?|stood|functions?|operates?|acts?)\s+as\b
\b(boasts|represents|embodies|exemplifies|epitomi[sz]es|showcases)\b
```

Rewrite each hit to *is*, *has* or the concrete verb, unless the verb is literally true: a function that serves a request serves it.

**Trailing participial impact clause.** A comma, a dash or a spaced double hyphen followed by a participle that adds significance instead of information.

```
(?:,|\u2014|\s--)\s*(highlighting|underscoring|emphasi[sz]ing|reflecting|symboli[sz]ing|showcasing|cementing|solidifying|ensuring|marking|contributing|fostering|cultivating|demonstrating|signal+ing)\b
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
\b(you\s+can|there\s+(is|are|was|were)|in\s+order\s+to|going\s+forward|utili[sz](e|es|ed|ing)|leverag(e|es|ed|ing)|facilitat(e|es|ed|ing)|delv(e|es|ed|ing))\b
```

**Collaborative residue.** Phrases addressed to the person who asked for the text, left inside the text itself (catalogued as collaborative communication and knowledge-cutoff disclaimers at https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing).

```
\b(i\s+hope\s+this\s+helps|let\s+me\s+know\s+if|feel\s+free\s+to|happy\s+to\s+help|great\s+question|as\s+of\s+my\s+last|here\s+is\s+(a|an|the)\s+(revised|updated|rewritten))\b
```

Every hit is deleted. None of them survives the deletion test in a published text.

**Rule of three.** Three adjectives, three parallel clauses or three examples where the third adds nothing (catalogued in the same inventory). No search catches it reliably, so it is read by hand: count the triads in the draft and cut each to the items that carry information.

## Combined pattern

For tell density, every class above and the whole flag list in one pattern, longest alternatives first. A regular expression engine returns matches that do not overlap, so a phrase caught by two lists, such as *rich tapestry* or *delve*, is one hit, not two. Saved to a file as one line, it is the pattern file the commands below read.

```
\b(?:i\s+hope\s+this\s+helps|let\s+me\s+know\s+if|feel\s+free\s+to|happy\s+to\s+help|great\s+question|as\s+of\s+my\s+last|here\s+is\s+(?:a|an|the)\s+(?:revised|updated|rewritten))\b|\b(?:experts?|observers?|critics?|analysts?|researchers?|industry\s+reports?|several\s+sources|some|many)\s+(?:say|says|argue|argues|note|notes|suggest|suggests|believe|believes|have\s+(?:cited|noted|argued))\b|\bnot\s+(?:only|just|merely|simply)\b|\bis\s+not\s+[^.,;]{1,60},\s+it\s+is\b|\brather\s+than\b|(?:,|\u2014|\s--)\s*(?:highlighting|underscoring|emphasi[sz]ing|reflecting|symboli[sz]ing|showcasing|cementing|solidifying|ensuring|marking|contributing|fostering|cultivating|demonstrating|signal+ing)\b|\b(?:serves?|served|stands?|stood|functions?|operates?|acts?)\s+as\b|\b(?:boasts|represents|embodies|exemplifies|epitomi[sz]es|showcases)\b|\b(?:testament|pivotal|crucial|vital|cornerstone|indelible|turning\s+point|paradigm|evolving\s+landscape|underscores?|deeply\s+rooted|rich\s+tapestry)\b|\b(?:you\s+can|there\s+(?:is|are|was|were)|in\s+order\s+to|going\s+forward|utili[sz](?:e|es|ed|ing)|leverag(?:e|es|ed|ing)|facilitat(?:e|es|ed|ing)|delv(?:e|es|ed|ing))\b|\b(?:additionally|align(?:s|ed|ing)?\s+with|boast(?:s|ed|ing)?|bolster(?:s|ed|ing)?|crucial(?:ly)?|deep\s+dives?|emphasi[sz](?:e|es|ed|ing)|enduring|enhanc(?:e|es|ed|ing|ement|ements)|ensur(?:e|es|ed|ing)|foster(?:s|ed|ing)?|garner(?:s|ed|ing)?|highlight(?:s|ed|ing)?|interplay|intricate(?:ly)?|key|landscapes?|meticulous(?:ly)?|robust(?:ly|ness)?|seamless(?:ly)?|showcas(?:e|es|ed|ing)|tapestr(?:y|ies)|underscor(?:e|es|ed|ing)|valuable|vibrant(?:ly)?|groundbreaking|renowned|nestled|in\s+the\s+heart\s+of|rich|profound(?:ly)?|diverse\s+array|commitment\s+to)\b
```

## Running the searches

Save the pattern to a file and the corpus to another, both UTF-8. The same count comes out of each form; a form whose tool is missing is skipped for the next one, and the tool used is named in the report.

- ripgrep, any shell: `rg -i --count-matches -f pattern.txt corpus.txt`.
- PowerShell 5.1 or 7, no ripgrep: `(Select-String -Path corpus.txt -Pattern (Get-Content pattern.txt -Raw).Trim() -AllMatches -Encoding utf8).Matches.Count`. Select-String is case-insensitive by default.
- Unix shell, no ripgrep: `LC_ALL=C.UTF-8 grep -o -i -P -f pattern.txt corpus.txt | wc -l`.
- Any shell with Node.js: the pattern as `new RegExp(pattern, 'gi')` over the corpus text, counting the matches.

One character differs by engine. The em dash is written `\u2014` for ripgrep, PowerShell and JavaScript, and `\x{2014}` for grep with Perl syntax, which rejects `\u`. The dash search is therefore `\u2014|\s--\s`, or `\x{2014}|\s--\s` under grep. The trailing participial search and the combined pattern carry the same `\u2014`, written `\x{2014}` under grep.

## Structural tells

These are formatting habits, and a published style rule usually already forbids each one.

- Title case in headings. Sentence case instead, and no period at the end of a heading (Microsoft style guide, https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice).
- Bold scattered mid paragraph. Bold marks a UI label or a term being defined, nothing else.
- A heading over a very short body. Convention: fewer than five lines of body under a heading means the heading is merged upward. A command, a code line or a table row counts as a body line, and the headings a reader scans a readme or a reference page for, such as install, run, configuration or demo accounts, stay whatever their length.
- A closing paragraph that restates what was already said. Delete it. The last sentence of the argument is the ending.
- A list whose items are full sentences. That was prose. Turn it back into prose, or cut each item to a fragment that earns the bullet.
- A heading whose only content is other headings, and a thematic break between every section.
- Inline-header lists: bullets that open with a bold label and a colon, then a sentence. Either the label is the item, or the item is prose.
- Emoji used as bullets or as heading decoration.
- Meta-labels such as *Key takeaway*, *Note*, *In summary* or *TL;DR* over a sentence that reads the same without them.
- Em dashes above the dash policy in [options.md](options.md), counted as in [measures.md](measures.md).

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
