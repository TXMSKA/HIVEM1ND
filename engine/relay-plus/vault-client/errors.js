export class VaultClientError extends Error {
    code;
    /** The prompt to wait for when a key needs approval. */
    prompt;
    constructor(code, options) { super(code, options); this.code = code; this.prompt = options?.prompt; this.name = "VaultClientError"; }
}
