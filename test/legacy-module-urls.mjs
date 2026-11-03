import { ApiError } from "../gui/app/api.mjs";

export function legacyModuleUrls(manifest, makeUrl) {
  const urls = new Map(), loading = new Set();
  let bytes = 0;
  const build = (key) => {
    if (urls.has(key)) return urls.get(key);
    const module = manifest.modules[key];
    if (!module || loading.has(key)) throw new ApiError(422, "import_unavailable", "The module cannot be exported.");
    loading.add(key);
    let source = module.source;
    for (const reference of [...module.imports].reverse()) {
      source = `${source.slice(0, reference.start)}${JSON.stringify(build(reference.key))}${source.slice(reference.end)}`;
      if (source.length > 16_000_000) throw new ApiError(422, "import_unavailable", "The module export exceeds its limit.");
    }
    if ((bytes += new TextEncoder().encode(source).length) > 16_000_000) throw new ApiError(422, "import_unavailable", "The module export exceeds its limit.");
    const url = makeUrl(source); loading.delete(key); urls.set(key, url); return url;
  };
  return Object.fromEntries(["module", "kit", "skins", "exporter", "schema", "icons", "nodes"].filter((key) => manifest[key]).map((key) => [key, build(manifest[key])]));
}

