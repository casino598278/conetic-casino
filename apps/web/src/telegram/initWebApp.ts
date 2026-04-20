interface TelegramTheme {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  button_color?: string;
  button_text_color?: string;
}

interface TelegramWebApp {
  initData: string;
  ready: () => void;
  expand: () => void;
  themeParams: TelegramTheme;
  /** Current visible viewport height in CSS pixels. Updates as the virtual
   *  keyboard opens/closes, user swipes down to minimise, etc. */
  viewportHeight?: number;
  /** Height once any transient keyboard animation settles. Stable between keyboard events. */
  viewportStableHeight?: number;
  isExpanded?: boolean;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy") => void;
    notificationOccurred: (type: "success" | "warning" | "error") => void;
  };
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void };
  initDataUnsafe?: { user?: { id: number; username?: string; first_name?: string; photo_url?: string } };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    // Non-Telegram env (browser dev). Still expose a CSS viewport height so
    // the shell sizes correctly against the window.
    syncViewportHeight(null);
    window.addEventListener("resize", () => syncViewportHeight(null));
    return;
  }
  tg.ready();
  tg.expand();
  // Paint Telegram's own chrome (header + bottom bar) in our current surface
  // tokens so the seam between their chrome and our app disappears. Stays
  // in sync with tokens.css via a single source of truth.
  const BG = "#0b1014";       // --c-bg
  const BG_DEEP = "#0e141a";  // --c-bg-2
  try { tg.setHeaderColor?.(BG_DEEP); } catch { /* older client */ }
  try { tg.setBackgroundColor?.(BG); } catch { /* older client */ }
  try { tg.setBottomBarColor?.(BG_DEEP); } catch { /* older client */ }

  // Sync viewport height to Telegram's reported value. iOS Telegram's
  // web-view does NOT reliably honour `100%` / `100vh` when its own header
  // and swipe-dismiss chrome are present — the document ends up taller than
  // the visible area and content gets clipped under the header. Using the
  // value Telegram tells us is the only way to be pixel-accurate.
  syncViewportHeight(tg);
  tg.onEvent?.("viewportChanged", () => syncViewportHeight(tg));
}

function syncViewportHeight(tg: TelegramWebApp | null) {
  const h = tg?.viewportStableHeight ?? tg?.viewportHeight ?? window.innerHeight;
  if (h > 0) {
    document.documentElement.style.setProperty("--tg-viewport-height", `${h}px`);
  }
}

// Silence unused-type warning; Telegram still passes themeParams but we skip them.
type _UnusedTheme = TelegramTheme;

export function getInitData(): string {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData) return tg.initData;
  // Dev escape hatch: ?devUser=123 → emit "dev:123:Alice" payload that the API recognises in NODE_ENV=development.
  const params = new URLSearchParams(window.location.search);
  const devUser = params.get("devUser");
  if (devUser) {
    const name = params.get("devName") ?? `Dev${devUser}`;
    return `dev:${devUser}:${name}`;
  }
  return "";
}

export function haptic(kind: "light" | "medium" | "heavy" = "light") {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(kind);
}

export function notify(kind: "success" | "warning" | "error") {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(kind);
}
