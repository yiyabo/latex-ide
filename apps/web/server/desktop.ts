/** Desktop shell uses a single local user and skips interactive login. */
export function isDesktopMode(): boolean {
  return (
    process.env.DESKTOP_MODE === "1" ||
    process.env.DESKTOP_MODE === "true" ||
    process.env.TAURI_ENV === "1" ||
    // Tauri injects this in some setups
    process.env.TAURI_PLATFORM != null
  );
}

export const DESKTOP_USER_EMAIL = "local@desktop";
export const DESKTOP_USER_NAME = "Local User";
