/** Entry point: builds the services, wires the global M-to-mute key, and renders the shell. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createServices, ServicesContext } from "./app/services.js";
import { App } from "./shell/App.js";
import "./styles/app.css";

const services = createServices();

// GDD §6.9: M toggles mute anywhere, except while typing.
window.addEventListener("keydown", (e) => {
  if (e.key !== "m" && e.key !== "M") return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  services.settings.set((s) => ({ ...s, muted: !s.muted }));
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");
createRoot(root).render(
  <StrictMode>
    <ServicesContext value={services}>
      <App />
    </ServicesContext>
  </StrictMode>,
);
