import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!swUrl || !registration) return;

    // Force immediate update check
    registration.update();
    setInterval(() => {
      registration.update();
    }, 60 * 1000);
  },
  onNeedRefresh() {
    window.location.reload();
  },
});

createRoot(document.getElementById("root")!).render(<App />);
