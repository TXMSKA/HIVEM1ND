# Files

Files that come in, files that are kept, and files that go back out: uploads, imports, attachments, avatars, archives, stored files, downloads and the libraries that decode them.

## Upload

**Applies when:** an upload, import, avatar, attachment or archive endpoint is added; the accepted types or the size limit change.

**Options:**

- **Type decided by content against an allowlist.** The default. Magic bytes, never the extension or the declared type, with a size cap and a file count cap.
- **Refuse SVG from users.** The default, since it is a document that can carry script. Rasterize or sanitize on the server when SVG is truly needed.
- **Malware scan.** Where uploaded files are passed on to other users or opened by staff.

**Open:** steps 1 and 5 of [file-upload](../protocols/file-upload.md).

## Storage and serving

**Applies when:** the storage location, the serving path or the serving headers change; a static directory is added.

**Options:**

- **Object storage or a separate origin.** The strongest separation: an uploaded file can never execute alongside the application.
- **A directory outside the repository and the web root, set by an environment value, served by a handler.** For a single server. The handler sets a fixed content type, `nosniff` and `Content-Disposition`.
- **Generated names.** Always. The caller's filename is a display label only.

**Open:** steps 2 and 3 of [file-upload](../protocols/file-upload.md); step 4 of [deployment-surface](../protocols/deployment-surface.md) for listing.

## Download and access to stored files

**Applies when:** a stored file is served back; a download or export link is generated; files are shared between accounts.

**Options:**

- **Serve through a handler that checks the caller against the owner.** The default.
- **Short-lived signed URLs.** For large files on object storage. The check happens when the URL is issued, and the lifetime is the exposure.

**Open:** step 6 of [file-upload](../protocols/file-upload.md); step 2 of [access-control](../protocols/access-control.md).

## Processing and decoders

**Applies when:** an image, document or archive library is added or upgraded; an image optimization endpoint is enabled; a new format is accepted.

**Options:**

- **Keep the decoder at a fixed version checked against its advisories.** Always.
- **Disable a format that cannot be made safe.** As the vendor did for one image format, per [incidents.md](../incidents.md).
- **Process in an isolated worker with its own limits.** When the application decodes many untrusted formats.

**Open:** step 4 of [file-upload](../protocols/file-upload.md); [framework-traps.md](../framework-traps.md#the-image-endpoint-is-a-server-side-fetch-proxy).
