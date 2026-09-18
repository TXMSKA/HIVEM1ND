name: design-specificity
purpose: Separate the choices made for this brief from the treatments that would appear on any brief.
scope: new surfaces and passes that set or change the visual direction
trigger: manual, before building a new surface and before any pass that changes the visual direction
repeat: once per surface
inputs: the brief or request, the surface under work, the token file, the rendered page
stop: the brief pins the visual direction in its own words, in which case the brief wins and the run ends after step 1
report: the subject, audience and primary job in one line each, the count of defaults found, and the replacement chosen for each

## Steps

1. Name the subject.
   Task: write one concrete subject, one audience and one primary job for the surface. Take them from the brief where it says them; where it does not, write them as a proposal and ask before continuing, or, in an unattended run, record the proposal as an assumption and continue. Distinctive choices come from the subject's own material and vernacular, so a subject written as a product category is not yet a subject. Name the mode of the surface from [direction.md](../direction.md) at the same time.
   Time: 10 minutes.
   Result: three lines recorded in the design plan, each naming something the brief actually contains, each under 120 characters.

2. Name the obvious version.
   Task: write, in one short paragraph, the layout and palette this category would produce by default, before designing anything. Then list the elements of the plan and mark each one as a default or as a choice made for this subject.
   Time: 15 minutes.
   Result: the paragraph is recorded, every element of the plan carries one of the two marks, and the count of each mark is written down.

3. Replace the defaults.
   Task: rewrite every element marked as a default, and record what changed and why in one line each. An element survives the mark only when a sentence of the brief earns it. In a refine, a default that breaks a floor has only its floor fixed, and every other default is reported as open with its fix, as in [defaults.md](../defaults.md), In a refine.
   Time: 30 minutes; when an element resists replacement, record it as an open question rather than shipping it unmarked.
   Result: the count of elements marked as defaults is zero, or each survivor carries the sentence of the brief that earns it, or, in a refine, is listed as open with its fix.

4. Search for template chrome.
   Task: run the searches in [defaults.md](../defaults.md) over the component tree.
   Time: 5 minutes.
   Result: every search returns zero hits, or each hit carries a file and line reference and the brief sentence that earns it.

5. Check the palette and the type against the clusters.
   Task: list the palette as named hex values with the role of each, and the typefaces with their roles. Compare both against the clusters in [defaults.md](../defaults.md).
   Time: 10 minutes.
   Result: the list is recorded, four to six colours with a role each, and no value falls inside a named cluster without a written justification.

6. Squint and mask.
   Task: capture the first viewport, then capture it again with the text hidden. Name the dominant object in each capture.
   Time: 10 minutes; a working screen in the Operate mode with no first viewport to argue ends this step as not applicable.
   Result: two screenshots of the first viewport, one with text and one masked, and the same dominant object named in both. Different objects, or no dominant object in the masked capture, means the hierarchy is carried by words alone and the composition is redesigned before coding continues.

7. Spend the boldness once.
   Task: on a Persuade or Experience surface, write the one gesture that belongs to the subject, as in [direction.md](../direction.md). Then list every element that competes for attention through scale, colour, weight or motion, keep the one that carries the gesture or the primary job, and quiet or remove the rest.
   Time: 10 minutes.
   Result: the gesture recorded in one line where the mode calls for it, exactly one element recorded as the bold one, and the count of elements quieted or removed written down.
