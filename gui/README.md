# Setup application

The browser and Windows desktop fronts render the same setup descriptors
and call the same setup engine. The HTTP server binds to `127.0.0.1`, uses a
random session token, checks the exact origin and host, and serves only the
three bundled interface assets.

New Windows minds default to `%LOCALAPPDATA%\Cosmic\onem1nd`. An explicitly
selected existing mind keeps its location, including a OneDrive folder; its
service configuration and staging stay in the local Cosmic directory.
Browser development can use the CLI path overrides:

```text
onem1nd init --gui --home-dir <temporary-home> --mind-path <temporary-mind>
```

After setup, the configured service serves the bundled `gui/app` interface.
The installer opens a local authenticated viewer after the service starts.
A failed service phase keeps setup at Install; retrying that button resumes
the service phases without copying the mind again.

The service observes eligible mind files and registered project resources
when files change. External Void text edits preserve the file and append an
outside-history entry in the same sync group. Incoming writes and changes
made through the service do not create duplicate outside-history entries.
Interrupted incoming groups recover from local journals before observation
starts, and deletions made while the service was closed are reconciled on
restart.
