# Site polish

Small additions that separate a site that works from a site that feels finished. None is architectural, most take an afternoon, and their absence is what a visitor registers as roughness without being able to name it. The first list is the order worth building them in; the second is a menu applied by the type of site. Where a protocol already proves an item, the item points at it.

## Build first

- **Site search.** Once navigation alone cannot reach a given page in two steps.
- **Mobile menu.** On any responsive site whose destinations do not fit one row at 320 CSS pixels, usually past four short items: it is the whole navigation on most sessions. Four or fewer short destinations stay visible, on a second row below the brand when needed, because core functions are never hidden on a phone.
- **Hover states.** Every interactive element reacts to the pointer, and the reaction is the same across the site. Measured in [colour-and-theming](protocols/colour-and-theming.md).
- **Form success state.** A real confirmation after a submission, never a silent reset. The person must know the message was sent.
- **Form error state.** Inline next to the field that failed, with the reason and the fix, and focus moved to the first failure. Proved in [forms-and-inputs](protocols/forms-and-inputs.md).
- **Confirmation modal.** On anything destructive or irreversible, and on a submission that cannot be repeated. It names what is about to happen instead of asking for a generic confirmation. Proved in [interface-states](protocols/interface-states.md).
- **Expandable FAQ.** On landing pages and documentation, where short answers would otherwise become a wall.
- **Floating contact or call to action.** On a lead-generation page, so the next step is reachable at any scroll position.
- **Skip to content.** One anchor, visible on focus, ahead of the navigation. Proved in [accessibility](protocols/accessibility.md).
- **Password visibility toggle.** Anywhere there is a login or a signup.
- **Copy button.** On snippets, identifiers, codes and anything that exists to be pasted elsewhere, with a short confirmation that the copy happened.

## Build when the site calls for it

- **Cookie banner.** Only where tracking, jurisdiction or compliance demands it. A banner with nothing to consent to is friction for nothing, and the preselected choice is always the most private one.
- **Loading animation.** Past the point where a response feels instant, restrained enough not to become the experience.
- **Scroll progress bar.** On long reads and documentation.
- **Sticky header.** On long pages with a navigation worth keeping reachable. It never covers a focused element.
- **Last updated date.** On documentation and articles, where age changes how the content should be read.
- **Print stylesheet.** Where documents are actually printed: contracts, reports, invoices.
- **Back to top.** On very long pages; redundant on short ones.
- **Custom not-found page.** With a way out: search, the main sections, or the home, never a dead end.
- **Call to action above the fold.** The intended action is visible without scrolling. On phones it can stay within reach as a sticky bar.
- **A page of its own after converting.** A thank-you page that confirms and says what happens next, not an alert.
- **Breadcrumbs.** On sites with a real hierarchy three or more levels deep.
- **Internal links.** Pages link to each other in their content, not only from the navigation.
- **Short FAQ.** The five questions that actually arrive by message, answered on the page.
- **Response time promise.** Next to a contact form, how long an answer takes.
- **Work shown, not adjectives.** Case studies, real reviews and a visible face where trust is part of the sale. Real ones or none.
- **Map and directions.** Only when there is a physical address to visit.

## Usually not needed

- **Light and dark toggle.** On a site that ships one theme, a toggle adds a second full theme to maintain for a preference the design already made. When the site ships both, the choice follows the one rule in [tokens.md](tokens.md), Themes.
