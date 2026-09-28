/**
 * The launcher's two ways to pick a subtree: the open-world corpus
 * FIELD (the same component the /axiom landing mounts) or
 * the LIST picker. The choice persists per
 * browser; unknown/absent stored values fall back to the map.
 */

export type LauncherMode = "field" | "list";

export const LAUNCHER_MODE_KEY = "axiom-launcher-mode";
export const DEFAULT_LAUNCHER_MODE: LauncherMode = "field";

export function parseLauncherMode(value: unknown): LauncherMode {
  return value === "list" || value === "field"
    ? value
    : DEFAULT_LAUNCHER_MODE;
}

export function readLauncherMode(): LauncherMode {
  if (typeof window === "undefined") return DEFAULT_LAUNCHER_MODE;
  try {
    return parseLauncherMode(
      window.localStorage.getItem(LAUNCHER_MODE_KEY),
    );
  } catch {
    return DEFAULT_LAUNCHER_MODE;
  }
}

export function storeLauncherMode(mode: LauncherMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAUNCHER_MODE_KEY, mode);
  } catch {
    // Private mode etc. — the preference just doesn't persist.
  }
}
