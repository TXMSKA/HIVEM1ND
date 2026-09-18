# Direction

How a look is chosen, stated and held before anything is built. The checks run in [design-specificity](protocols/design-specificity.md) and, for a change of look, in [theme-direction](protocols/theme-direction.md).

## Read the request first

- **The brief wins.** An aesthetic, an era, a face or a palette the brief pins is honoured, even against taste. A brand's existing artwork wins over its brand sheet when the two disagree.
- **A named surface with a pointed defect is a small fix.** A request that names a whole screen and then points at one broken part, often in a parenthesis, is asking for that part. The smallest version is shown first, and the rest of the screen is left alone.
- **Refine, evolve or replace.** A refinement keeps the identity, the copy and everything out of scope. An evolution keeps structure and content and changes the look in order of leverage: type, then spacing and rhythm, then colour, then motion, then the recomposition of the hero and key sections, then whole blocks; it stops as soon as the request is met. A replacement keeps the product's truth and changes the look entirely. The look being thrown away is never polished.
- **A new part inside an existing look inherits it.** A new section, card or dialog is built in the vocabulary its neighbours already use, not as an identity exercise.
- **On a redesign some things never move silently**: URLs, anchors, navigation labels, form field names and order, the logo, and legal and consent text.

## Name the mode

The surface decides the mode, not the product. One product can hold several.

| Mode | Surfaces | Leans toward |
| --- | --- | --- |
| Persuade | Landing, pricing, launch | One hook, one visible action, a clear reading order, one committed gesture |
| Operate | Apps, dashboards, admin | Density where it is used, standard patterns, colour for action and state only, quiet motion |
| Read | Documentation, articles | Measure, rhythm, one reading path, related links collected at the end |
| Experience | Portfolios, story pages | Immersion, a full-bleed first screen, scroll pacing |

## Set the dials

Three dials from 1 to 10 make a direction discussable before it is built.

- **Variance.** Low is symmetric columns and centred blocks; middle adds offsets, overlaps and mixed ratios; high is fractional columns and large deliberate voids. High variance still collapses to one clean column on a phone.
- **Motion.** Low is hover and press states only; middle is fluid transitions with short cascades; high is scroll choreography and pinned sequences. Motion claimed on the dial ships working, or the dial drops.
- **Density.** Low is airy; high is a cockpit with rules instead of boxes and tabular figures everywhere. The default leans tight, per the density rules in [tokens.md](tokens.md).

Rough starting points: an operating tool sits low on variance and motion and high on density; a trust-first public service sits low on all three but density; a promotional landing sits high on variance and motion.

## Choose the colour strategy

- **Restrained.** Neutrals plus one accent kept for actions, selection and state. The default for Operate and Read.
- **Committed.** One saturated colour owns a large part of the surface, whole regions rather than scattered accents.
- **Full palette.** Three or four named roles, each with a job.
- **Drenched.** The surface itself is the colour.

Light or dark is decided by one sentence about the physical scene: who uses it, where, under what light. Never by product category.

## Find the gesture

For a Persuade or Experience surface, write in one line the gesture that belongs to the subject: the physical act of the trade or the world it comes from, turned into one interaction. One movement with an argument, performed once and well, with the chrome around it quiet. This line is written before any layout exists; a surface that cannot name its gesture has not found its direction yet.

## Write the contract

Before code, a direction fits in about 150 words:

- **Thesis.** What the surface argues, in one sentence.
- **Its own world.** The materials, lettering, surfaces and light of the subject, named concretely rather than as a mood.
- **Story.** The order in which the surface reveals itself.
- **First viewport.** The object it is built around.
- **Form.** The palette as four to six named values with a role each, the type roles and faces, the radius system, the motion level.

A contract that reads like a mood board means the direction is not decided.

## Offer real alternatives

When a direction is open, show three variants of equal weight, each diverging on a named axis: layout, density, type system, colour strategy, motion vocabulary or interaction model. Two variants that differ only in colour or copy are one variant. Each works with real content and real interactions, is shown one at a time at full size in realistic surroundings, and is described by the axis it takes, when it wins and what it costs. The category-standard version is always one quiet option, built at full craft if chosen.

## Restyle by theme

A requested look such as a period, a genre or a material world is applied through the primitive layer only, as in [theme-direction](protocols/theme-direction.md): colour ramps, faces, type scale, radius, shadow and texture move; semantic roles and components stay. The display face is sourced and self-hosted to match the world; the nearest installed face is not a fallback. Textures come from the subject's own world, and a CSS gradient standing in for paper, cloth or metal is a costume.
