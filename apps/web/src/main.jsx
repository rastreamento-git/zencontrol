import { initializeAppearance } from "@zen/ui/lib/appearance";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@zen/ui/styles/base.css";
import "@zen/ui/styles/theme.css";
import "@zen/ui/styles/zencontrol.css";
import AuthGate from "@zen/ui/components/AuthGate";
import Feedback from "@zen/ui/components/Feedback";
import TrackingEntry from "./TrackingEntry";
import "@zen/ui/styles/appearance.css";
initializeAppearance();
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthGate>
      <TrackingEntry />
    </AuthGate>
    <Feedback />
  </StrictMode>,
);
