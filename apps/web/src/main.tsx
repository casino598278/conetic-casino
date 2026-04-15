import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { initTelegram } from "./telegram/initWebApp";
import { ErrorBoundary } from "./ui/ErrorBoundary";

initTelegram();

// StrictMode disabled in production — its double-mount confuses PixiJS init.
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
