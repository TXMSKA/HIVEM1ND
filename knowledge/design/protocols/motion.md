name: motion
purpose: Keep motion purposeful, short, compositor-only, interruptible and reducible.
scope: transitions, animations, transforms, reveals, scroll effects and gestures on any rendered surface
trigger: manual, on any transition, animation, transform, reveal, scroll effect or gesture, and on a request to add motion
repeat: once per surface, and again whenever an animation is added
inputs: the stylesheet and animation code, the rendered page, the reduced motion setting
stop: a required animation cannot be expressed in transform, opacity and clip path, in which case the effect is redesigned rather than moved onto layout properties
report: the animation table with purpose, frequency, duration and curve, the animations removed, the searches with zero hits, and the reduced motion capture pair

## Steps

1. Run the gates.
   Task: list every animated element and run it through the frequency, purpose, budget and function gates in [animation.md](../animation.md). Cut what fails. On a marketing surface, name the one committed gesture; on a working app, keep motion to feedback, anchored overlays and short crossfades.
   Time: 20 minutes.
   Result: one row per surviving animation naming its purpose and frequency tier, the count removed with the gate that removed each, and zero animation on shortcuts, focus movement and list navigation by keyboard.

2. Set durations and curves.
   Task: assign each animation a duration from the table in [animation.md](../animation.md) and an explicit curve by direction: decelerating for entrances and exits, symmetric for movement on screen, linear only for constant motion.
   Time: 20 minutes.
   Result: the computed duration and timing function of every transition read from the running page, interface motion at or under 300 milliseconds, travelling overlays at or under 500, no built-in keyword curve on a deliberate animation, and zero accelerating curves on interface motion.

3. Animate only what the compositor carries.
   Task: restrict animation to transform, opacity and clip path, list the properties explicitly, set the transform origin at the trigger for anchored surfaces, and start no scale below 0.9.
   Time: 20 minutes.
   Result: the searches `transition[^;]*\b(width|height|top|left|margin|padding)\b`, `transition:\s*all` and `scale\(0\)` each return zero hits, and hover motion never changes the element's box.

4. Keep it interruptible.
   Task: trigger every quickly repeated animation twice in a row and grab every draggable surface mid-motion. Use transitions rather than keyframes for anything retriggered, springs for anything a hand drives, and never lock input during a transition.
   Time: 15 minutes; a surface with no retriggered animation and nothing draggable ends this step as not applicable.
   Result: a transcript of one animation interrupted mid-run and retargeting from its on-screen position, and one drag released with a flick that settles with its velocity.

5. Protect the reading.
   Task: load the page cold and check that no reveal or stagger holds back text in the first viewport, that reveals fire once, and that text keeps its contrast at the midpoint of every fade.
   Time: 15 minutes.
   Result: the first viewport readable at first paint in a screenshot, reveals firing once, and the contrast at the midpoint frame recorded above its target.

6. Honour the reduced motion preference.
   Task: under the reduced motion setting, drop travel, springs, parallax and loops, and keep opacity and colour feedback so every confirmation still happens.
   Time: 20 minutes.
   Result: a pair of screenshots of the same state change at each motion preference showing the same end state, and a transcript confirming every confirmation still occurs. A tool that cannot emulate the preference records the reduced motion block read from the stylesheet with what it removes, as in [evidence.md](../evidence.md), Tool limits.

7. Feel it, then limit the loops.
   Task: play each surviving animation at a quarter of its speed, check the origin, the curve and the sync of coordinated properties, and give any autoplaying motion that runs longer than 5 seconds a control to pause, stop or hide it.
   Time: 15 minutes.
   Result: one line per animation noting the slowed check, and the count of autoplaying loops with their durations and their controls.
