name: motion
purpose: Keep motion short, compositor-only, purposeful and reducible.
trigger: manual, on any transition, animation, transform, reveal or scroll effect
repeat: once per surface, and again whenever an animation is added
inputs: the stylesheet and animation code, the rendered page, the reduced motion setting
stop: a required animation cannot be expressed in transform and opacity, in which case the effect is redesigned rather than moved onto layout properties
report: the duration and easing of every transition, the count of animated layout properties, and the reduced motion capture pair

## Steps

1. Earn each animation.
   Task: list every animated element and write what its motion explains: a state change, a continuity between two positions, or the confirmation of an action. Cut the rest. One orchestrated moment per surface lands; a fade and slide on every section and a transition on every card is the generic default and reads as such.
   Time: 20 minutes.
   Result: one line per surviving animation naming what it explains, and the count of animations removed. Motion that answers no action and explains no change is recorded as removed, not as pending.

2. Set the durations.
   Task: assign a duration to each animation by its size. Simple feedback such as a toggle or a checkbox sits near 100 milliseconds, where it reads as physical manipulation. Ordinary interface transitions sit between 150 and 200. A substantial change such as a modal or a panel sits between 250 and 300. A large movement reaches 400 at most. From 500 upward the interface feels like a delay.
   Time: 15 minutes.
   Result: the computed duration of every transition read from the running page and recorded in milliseconds, none at or above 500.

3. Set the easing.
   Task: give entrances a decelerating curve, which starts fast and settles so the eye can follow the element to its final position, and give exits an accelerating curve. Write the curves as explicit cubic-bezier values rather than the built-in keywords: a decelerate curve such as `cubic-bezier(0, 0, 0, 1)` or the softer `cubic-bezier(0.05, 0.7, 0.1, 1)`, an accelerate curve such as `cubic-bezier(0.3, 0, 1, 1)`, and a standard curve such as `cubic-bezier(0.2, 0, 0, 1)` for a change that stays on screen. Linear motion is never the answer, and an entrance may run slightly longer than the matching exit.
   Time: 15 minutes.
   Result: the computed timing function of every transition recorded, with no keyword curves left and every entrance and exit pair using opposite curves.

4. Animate only what the compositor can carry.
   Task: restrict animation to transform and opacity, list the properties explicitly, and set the transform origin to where the motion physically starts. A scale never starts at zero, because the element springs out of nothing and the eye loses it.
   Time: 20 minutes.
   Result: the search for animated layout properties such as top, left, width and height returns zero hits, the search for an unlisted blanket transition returns zero hits, and no keyframe starts a scale at zero.

5. Match the motion to the frequency.
   Task: rank the animated interactions by how often a person performs them. The more frequent the interaction, the less it may animate, down to none. An action started from the keyboard does not animate at all, because the person is already moving faster than the animation.
   Time: 10 minutes.
   Result: the ranked list with a duration against each, decreasing as frequency rises, and zero animation on keyboard-initiated actions.

6. Honour the reduced motion preference.
   Task: under the reduced motion setting, drop the travel and keep the state change. The element still appears, still changes, and still confirms; it simply does not move. A blanket rule that reduces every duration to near zero destroys the feedback the motion carried.
   Time: 20 minutes.
   Result: a pair of screenshots of the same state change, one at each motion preference, showing the same end state, plus a transcript confirming that every confirmation still occurs.

7. Keep it interruptible.
   Task: make every animation interruptible and driven by input. Restrict autoplay to muted, non-essential loops, and give any autoplaying motion that runs longer than 5 seconds alongside other content a control to pause, stop or hide it.
   Time: 15 minutes.
   Result: a transcript of one animation interrupted mid-run and settling correctly, and the count of autoplaying loops with their durations and their controls.
