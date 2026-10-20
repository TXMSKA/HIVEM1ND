name: file-upload
purpose: Prove an uploaded file cannot execute, cannot come back as script, and cannot exhaust the disk.
scope: uploads, imports, avatars, attachments, archives, stored files and their serving path, generated documents and image transforms
trigger: task close
repeat: once
inputs: the upload endpoints, the storage configuration, the serving path, a set of test files
stop: an uploaded file executes on the server or renders as script in a viewer's browser, which is reported at once and ends the protocol
report: the accepted type list with how it is decided, the stored path and name per upload, the serving headers, the ceilings with the response at each, and the decoder versions

## Steps

1. Read the accepted types, and how they are decided.
   Task: for each upload path, read the allowlist of accepted types and how the type is checked: by the file's own content, never by the extension or the client-declared type. Common signatures at offset 0: PDF `25 50 44 46 2D`, PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, GIF `47 49 46 38 37 61` or `47 49 46 38 39 61`, WebP `52 49 46 46` then `57 45 42 50` at offset 8, ZIP `50 4B 03 04`. A PDF can carry script, so it is served as an attachment under a `sandbox` policy. Then upload a pair of mismatched test files: the correct extension with the wrong content, and the correct content with an executable extension.
   Time: 25 minutes. Repository, plus running application.
   Result: the allowlist per endpoint with its entries, and one line per test file showing each mismatch rejected. SVG from users is refused unless it is rasterized or sanitized on the server.

2. Take the caller's filename out of the path.
   Task: read whether files are stored under a generated name with the original kept only as a display label. Send filenames containing traversal sequences, null bytes, leading dots, reserved device names and a very long name.
   Time: 25 minutes. Running application, plus a read of the storage location.
   Result: the stored path and generated name per upload, read from the filesystem or the object store, showing every payload landed inside the intended prefix with a name that contains none of the payload.

3. Serve what was stored as data, never as code.
   Task: read where files are stored: outside the repository, the web root and any directory the server executes from, at a location set by an environment value, ideally on object storage or a separate origin. Where uploaded files are passed on to other users or opened by staff, read whether they are scanned for malware before they are served. Then read the headers on the serving response and request an uploaded script file.
   Time: 25 minutes. Running application.
   Result: `X-Content-Type-Options: nosniff`, a content type from the allowlist rather than from the file, `Content-Disposition: attachment` for anything not rendered inline with the display name in an encoded `filename*` parameter per RFC 6266, and the script file returned as bytes rather than executed, with the status and the body. The malware scan is recorded as present, with a test file it flagged, or as not applicable with the reason.

4. Treat the decoder as the attack surface.
   Task: image, document and archive libraries parse hostile input in a process holding the application's privileges. Record each processing library and its version, and compare against its advisories fetched in this pass, per [framework-traps.md](../framework-traps.md#the-image-endpoint-is-a-server-side-fetch-proxy).
   Time: 30 minutes. Repository, plus network access to the advisory pages.
   Result: one line per library with installed version, fixed version, advisory identifier and advisory URL. Where a format cannot be made safe, the configuration that disables that format is quoted.

5. Find the ceilings on size, count and expansion.
   Task: read the maximum body size, the maximum file count per request and per account, and the maximum expansion ratio and entry count for archives. Then send a file above the limit, a request above the count, and an archive that expands far beyond its compressed size.
   Time: 30 minutes. Running application.
   Result: the status code returned at each ceiling, received by the client, and nothing past the limit buffered, stored or processed. On some servers, answering and closing the socket at once resets the connection and the client never sees the 413, so the handler answers, discards the rest of the body, and cuts the socket after a short bounded time. The disk usage measured before and after the archive test shows no growth.

6. Keep the upload path behind the same checks as everything else.
   Task: confirm the endpoint requires authentication where it should, checks the caller and the owner of the target record before reading the body, applies the rate limit from [resource-limits](resource-limits.md), and that reading a stored file checks the caller against its owner. Request one stored file as its owner first, as the positive control.
   Time: 20 minutes. Running application.
   Result: the owner's request answering 2xx, the same file requested by another account answering 404 as [api-conventions.md](../api-conventions.md#status-codes-that-do-not-leak) sets out, and the rate limit response recorded on the upload path itself.
