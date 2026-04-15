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
  if (!tg) return;
  tg.ready();
  tg.expand();
  // We deliberately IGNORE tg.themeParams — we want our own dark-grey casino
  // theme regardless of the user's Telegram theme (some are navy/blue tinted).
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
