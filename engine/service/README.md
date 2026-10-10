# HIVEM1ND service

The core service is one process per user. `node cli/index.mjs service run` is the process entry. This build does not start that process unless a caller injects a runtime. It does not search for an unrelated mind.

`service install --dry-run` prints the login plan and does not register a task, LaunchAgent, or user unit. `service install` without a dry run still refuses to call the operating system unless a test injects a recording runner. `service status` reports that no operating-system query was made. `service uninstall` describes the owned delete command. A registration whose stored body no longer matches its digest is kept.

The mind lives under a Cosmic folder. The default is local Cosmic `hivem1nd`. A custom Cosmic parent appends `hivem1nd`. Staging stays under local Cosmic, in `hivem1nd-service/<mindKey>/<machine>/staging`. A new folder origin defaults to `hivem1nd-origin/<mindKey>` beside the mind, not inside it. OneDrive may hold a mind or an origin. Staging is rejected inside the mind, the origin, or a synced root. An existing config keeps its origin on a later attach or evolve.

Setup accepts `serviceSetup` only when the caller sets it. Library planning stays inert without that flag. When it is set, config is written before a starter runs. A failed start can be retried without copying the mind again and without repeating a registration that already matches. The static wizard page still submits the mind path it already knows. Origin fields are on the session and default when omitted. A completed install opens the viewer URL once when one is returned, and closing the wizard does not stop the service.

A second mind does not take the lock held by the first.

Native login is reported only after a verified session. A version probe is not a login. Home access expires twelve hours after it is opened. Offline publication pauses at the hard byte and message limits, and a conflict keeps both copies.

Integrated QA runs the core tests, lint, and build from this kit after the core branch is merged with the interface branch. Do not treat a missing native login or a missing pinned Node archive as a passed smoke.
