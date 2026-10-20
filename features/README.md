# Features

Fifteen in the base, plus the ones a knowledge module ships, with a folder when a feature has scripts. Frontmatter: `name`, `description` and `category` (`planning`, `quality` or `continuity`), read by the installer to group the content step.

A feature file holds, in this order: the `Mind: {{mind}}` line, which the installer fills with the mind's path; the `Argument`; one Start line that points at Locate in `rules.md`, skipping the step that asks for a unit when the feature does not write as one; the Steps; and an End that says when it stops and what it reports.
