# Setup application

The browser and Windows desktop fronts render the same ten setup descriptors
and call the same setup engine. The HTTP server binds to `127.0.0.1`, uses a
random session token, checks the exact origin and host, and serves only the
three bundled interface assets.

The packaged desktop app stores its mind in `HIVEM1ND` under the current
Windows home by default. Browser development can use the CLI path overrides:

```text
hivem1nd init --gui --home-dir <temporary-home> --mind-path <temporary-mind>
```
