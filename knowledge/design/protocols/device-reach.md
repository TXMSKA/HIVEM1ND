name: device-reach
purpose: Run the approved experience smoothly on the cheapest possible devices, with the least visual sacrifice.
scope: any surface, animation, background or build that ships to users
trigger: task close
repeat: once
inputs: approved captures, the build and primary flow, available emulators and profilers, target budgets
stop: a measured budget fails or an approved state changes; missing tools are recorded as not checked and the pass continues
report: per profile, settings, captures, measurements, pass or fail or not checked with the reason, visual differences and extras

## Steps

1. Keep the approved baseline.
   Task: save the approved captures of the key states with viewport, density, theme and content; name the primary flow, including input during motion, scrolling and offscreen work. Nothing shown or approved is discarded to meet a cost target; optimise how resources are spent first. Heavy local models are outside the performance scope; macOS and iOS stay out while paid developer accounts are required.
   Time: 10 minutes; stop if the baseline is still missing.
   Result: dated captures and a repeatable flow, with the exclusions named.

2. Set the budget and recording.
   Task: record a cold load and 30 seconds of the flow under each profile with DevTools Performance, Memory and Network or the runtime profiler. Defaults: 60 frames per second, p95 frame interval at most 16.7 ms, main-thread and GPU work each at most 8 ms per frame; no tasks over 50 ms during interaction, cold-load long-task blocking at most 200 ms; JS heap at most 128 MiB, total product process memory at most 512 MiB; initial compressed script at most 300 KiB, first-view transfer at most 1 MiB, native package at most 50 MiB. Record any agreed product-specific budget before measuring.
   Time: 10 minutes; record unavailable metrics with the reason and continue.
   Result: budget table, trace recipe and build sizes; every metric has a tool or a stated limit.

3. Simulate a low-end Android phone.
   Task: use browser Device Mode at 360 by 640 CSS pixels, density 2 and touch, with 6-times CPU throttling; restrict the test processes to two logical CPUs as in step 4, and cap memory at 2 GiB where a virtual machine or container is at hand, otherwise record memory as not limited. For an Android app, use an Android Emulator AVD with two cores and 2 GiB RAM. Replay step 1 and record step 2. Device Mode approximates browser resources, not Android OS or GPU performance; record those limits separately.
   Time: 15 minutes; mark unavailable settings or runtimes not checked and continue.
   Result: captures, trace and actual limits for the mobile browser and applicable Android app, with no claim for an unmodelled resource.

4. Simulate a weak computer with a usable GPU.
   Task: use 1366 by 768 CSS pixels, density 1, 4-times browser CPU throttling, and memory capped at 4 GiB where a virtual machine or container is at hand, otherwise recorded as not limited. Restrict all test processes to two allowed logical CPUs through Task Manager's Set affinity on Windows or `taskset -apc <two-allowed-cpus> <pid>` on Linux. Keep hardware acceleration enabled, verify the renderer in the runtime diagnostics, then replay and record. CPU throttling does not throttle the GPU; record its identity and any supported resource cap, never infer a weak GPU from a powerful host.
   Time: 15 minutes; mark limits that cannot be applied not checked and continue.
   Result: trace, captures, affinity and memory limits, renderer and the exact extent of GPU simulation.

5. Simulate a weak computer with software rendering.
   Task: repeat step 4 in a separate Chromium test profile with `--use-gl=angle --use-angle=swiftshader`, as in the [renderer documentation](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md); verify software rendering in `chrome://gpu`. For another runtime use its documented software renderer. Record unsupported graphics APIs rather than silently substituting them.
   Time: 15 minutes; mark an unavailable software renderer not checked and continue.
   Result: renderer diagnostics, captures and trace under the same CPU and memory limits.

6. Simulate Linux.
   Task: run the browser and applicable Linux build in a Linux virtual machine limited to two vCPUs and 4 GiB RAM, at step 4's viewport and density; repeat with accelerated and software rendering when supported, recording each renderer and step 2's measurements. A changed user agent on another OS is not a Linux check.
   Time: 20 minutes; mark a missing guest, build or renderer not checked and continue.
   Result: guest version, resource limits, captures and traces per renderer, or the missing capability and reason.

7. Check other engines and the product's app.
   Task: replay the flow in available Gecko and WebKit test runtimes and the product's own app, at the mobile and computer limits above where applicable. Use each runtime's profiler and resource controls; report each engine and app separately. An engine test does not establish iOS or macOS support, and a browser test does not establish app support.
   Time: 20 minutes; mark each unavailable runtime or resource control not checked and continue.
   Result: runtime versions, settings, captures and measurements per target, with explicit gaps.

8. Compare the visuals.
   Task: place before-and-after captures beside the approved states at the same size, density, theme and content; compare controls, icons, type, spacing, backgrounds and motion frames. Solve cost by reducing redundant, hidden or offscreen work before any visible sacrifice; a remaining visible change needs approval.
   Time: 10 minutes; stop on an unapproved difference or an unfinished comparison.
   Result: capture pairs and a list of differences, each resolved or explicitly approved.

9. Separate the default from heavy extras.
   Task: repeat each checked profile with the shipped defaults and with heavy extras off and up; exercise input and reduced motion. The approved default must meet the budget without a switch. Accept an animation or moving background only with a smooth frame trace on a low-end profile.
   Time: 15 minutes; stop if the default fails, record unavailable checks with the reason.
   Result: per-profile traces for default, off and up, responsive input and reduced motion; optional extras have their costs recorded.

10. Report every profile.
    Task: append the settings, evidence paths and measured values against the budgets to the task Report, one row per profile and runtime. A missing required resource limit makes the profile not checked, with the reason and any partial evidence; a missing metric is also named, never inferred from another run. Restore test-only resource controls.
    Time: 5 minutes; an unfinished report leaves verification incomplete.
    Result: every target has pass, fail or not checked and a reason; the default and each visual difference have a verdict.
