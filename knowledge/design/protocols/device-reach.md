name: device-reach
purpose: Run the approved experience smoothly on the cheapest possible devices, with the least visual sacrifice.
scope: any surface, animation, background or build that ships to users
trigger: task close when the closed work matches the scope, or manual
repeat: once per surface, and again whenever an animation, a background or a heavy asset is added
inputs: the approved design captures, the build and its primary flow, the emulators and profilers at hand
stop: a budget still failing after the fixes of step 8, or a fix that would change an approved visual without the user's approval; the failing profile and metric, or the two options with a pick in one line, go to the user
report: per profile and runtime, the limits applied, captures, measurements, pass, fail or not checked with the reason, visual differences, and the heavy extras with their cost

## Steps

1. Fix the approved baseline.
   Task: save a capture of every key state of the approved design, each named with its viewport, density, theme and content. Write the primary flow as a numbered list that includes input during motion, scrolling and work that runs offscreen. Nothing shown or approved is removed to save cost. Out of scope: heavy local models, and macOS and iOS while they need paid developer accounts.
   Time: 10 minutes; without approved captures, stop and ask the user which design is approved.
   Result: dated captures, the numbered flow and one line naming the exclusions.

2. Set the budgets, the recording and the launch recipe.
   Task: use these budgets unless the task records others: 60 frames per second with p95 frame interval at most 16.7 ms; main-thread work and GPU work each at most 8 ms per frame; no task over 50 ms during interaction; blocking time of long tasks in a cold load at most 200 ms; JS heap at most 128 MiB; memory of all the product's processes at most 512 MiB; compressed initial script at most 300 KiB; first-view transfer at most 1 MiB; native package at most 50 MiB. Record 30 seconds of the flow after a cold load (hard reload, cache disabled) in the Chrome DevTools Performance panel, reading frames, main thread and GPU from its tracks; transfer from the Network panel; heap from `performance.memory.usedJSHeapSize`; process memory from the browser Task Manager (Shift+Esc); package size from the build artefact. Launch every test browser as a new instance with its own `--user-data-dir`, restricted to two logical CPUs: on Windows `cmd /c start /affinity 3 "" "<chrome.exe>" --user-data-dir=<dir> <flags>`, on Linux `taskset -c 0,1 <chromium> --user-data-dir=<dir> <flags>`. A profile whose resource cannot be limited with the tools at hand, or a metric that cannot be read, is recorded as not checked with the reason; a value is never taken from another profile or inferred.
   Time: 10 minutes; a metric without a tool is recorded as not checked and the run continues.
   Result: the budget list, the tool that reads each metric and the launch commands for this machine, with every metric naming a tool or marked not checked.

3. Simulate a low-end Android phone.
   Task: in the test browser's Device Mode add a custom device of 360 by 640 CSS pixels, device pixel ratio 2, mobile and touch; set CPU throttling to 6x slowdown in the Performance panel; replay step 1 and record as in step 2. Cap memory at 2 GiB through a virtual machine or a container when one is at hand, otherwise record memory as not limited. For an Android app, create an Android Virtual Device in Android Studio and start it with `emulator -avd <name> -cores 2 -memory 2048`. Device Mode and throttling approximate browser resources, not the Android system, the GPU or heat: record that sentence in the report.
   Time: 15 minutes; a missing emulator or setting is recorded as not checked and the run continues.
   Result: captures, a trace and the applied limits for the mobile browser and for the Android app, each marked pass, fail or not checked.

4. Simulate a weak computer with a usable GPU.
   Task: set the viewport to 1366 by 768 CSS pixels at density 1, CPU throttling to 4x slowdown, two logical CPUs through the launch recipe, and memory capped at 4 GiB through a virtual machine or a container when one is at hand, otherwise recorded as not limited. Leave hardware acceleration on and record the GPU model shown in `chrome://gpu`. Replay step 1 and record as in step 2. Throttling does not slow the GPU: record the GPU as not limited, never as weak.
   Time: 15 minutes; a limit that cannot be applied is recorded as not checked and the run continues.
   Result: trace, captures, the CPU and memory limits applied and the GPU model.

5. Simulate a weak computer with no usable GPU.
   Task: repeat step 4 in a new browser instance launched with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` (`--disable-gpu` alone when the product uses no WebGL). Confirm in `chrome://gpu` that the features read software only and the renderer names SwiftShader. For another runtime use its documented software-rendering switch. A graphics API the software renderer lacks is recorded as unsupported, never replaced silently.
   Time: 15 minutes; an unavailable software renderer is recorded as not checked and the run continues.
   Result: the `chrome://gpu` reading, captures and a trace under the same CPU and memory limits as step 4.

6. Simulate Linux.
   Task: run the browser and the Linux build of the app in a Linux virtual machine, or in WSL2 on Windows with `processors=2` and `memory=4GB` under `[wsl2]` in `%UserProfile%\.wslconfig` followed by `wsl --shutdown`. Use step 4's viewport and density, replay step 1 and record as in step 2, once per renderer the guest offers (accelerated and software). Changing the user agent is not a Linux check.
   Time: 20 minutes; a missing guest, build or renderer is recorded as not checked and the run continues.
   Result: guest version, limits, renderer, captures and trace for each renderer run, or the missing capability with its reason.

7. Check the other engines and the product's own app.
   Task: replay the flow in Firefox and in WebKit through Playwright (`npx playwright install firefox webkit`, then a script that opens the product in each) at step 3's and step 4's viewports and the launch recipe's two CPUs; CPU throttling exists only in Chromium, so record it as not checked there. Run the product's own app, such as an Electron or other desktop build, under the same recipe and its own profiler. Report each engine and the app separately. A WebKit result does not establish iOS or macOS support, and a browser result does not establish app support.
   Time: 20 minutes; an unavailable engine or app is recorded as not checked and the run continues.
   Result: runtime versions, limits, captures and measurements per engine and app, with each gap named.

8. Fix cost failures, then compare the visuals.
   Task: for each budget marked fail, cut cost in this order and re-measure the failed profile after each change: stop hidden and offscreen work (pause animations and timers with IntersectionObserver and `document.hidden`, `content-visibility: auto` on long offscreen sections); move animation to `transform` and `opacity` ([motion](motion.md), step 3); size images and canvases to the displayed size and density; remove repeated layout, paint and script work. Then place each before and after capture beside the approved one at the same size, density, theme and content, and compare controls, icons, type, spacing, backgrounds and motion frames. A change a person can see needs the user's approval before it stays.
   Time: 20 minutes; a budget still failing after the fixes, or an unapproved visual change, ends the run at the stop rule.
   Result: the re-measured value for each fix, and a list of capture pairs with each difference marked resolved or approved.

9. Separate the default from the heavy extras.
   Task: heavy extras are optional features the person can switch off or up, such as a particle field, a 3D scene or a video background. Repeat the flow on every profile checked in steps 3 to 7 with the shipped default, then with extras off, then with extras up, and once more with the DevTools Rendering panel set to emulate `prefers-reduced-motion: reduce`. The shipped default, with no switch touched, must meet every budget: it never depends on a switch being turned off. An animation or a moving background passes only when its trace holds 60 frames per second at p95 16.7 ms on the phone and weak computer profiles.
   Time: 20 minutes; a default that fails ends the run at the stop rule, and an unavailable check is recorded as not checked.
   Result: per profile, the trace of default, off and up, input still responding during motion, the reduced-motion run, and the cost of each extra.

10. Report every profile.
    Task: append one row per profile and runtime to the task Report: limits applied, evidence paths, measured values against the budgets, and pass, fail or not checked with the reason. A profile whose required limit could not be applied is not checked, with any partial evidence named. Close the test instances, delete the temporary profile folders and revert any `.wslconfig` edit.
    Time: 5 minutes; without the report, verification of the task is incomplete.
    Result: every profile, the default and each visual difference carry a verdict, and no value is inferred from another run.
