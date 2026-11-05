// Adapted from @txmska/cosmic 0.1.0; retain its shared-store wire format and lock protocol.
import os from "node:os";
import path from "node:path";

export function cosmicRoot(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.COSMIC_HOME) return path.resolve(env.COSMIC_HOME);
  if (platform === "win32") {
    return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "Cosmic");
  }
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "Cosmic");
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, ".local", "share"), "Cosmic");
}

export const cometFile = (root = cosmicRoot()) => path.join(root, "shared", "comet", "collection.json");
export const walletFile = (root = cosmicRoot()) => path.join(root, "shared", "wallet", "ledger.json");
export const keysFile = (root = cosmicRoot()) => path.join(root, "shared", "keys", "account.json");
