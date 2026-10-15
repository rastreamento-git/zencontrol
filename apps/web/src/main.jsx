import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@zen/ui/styles/base.css";
import "@zen/ui/styles/theme.css";
import "./zencontrol.css";
import AuthGate from "@zen/ui/components/AuthGate";
import Feedback from "@zen/ui/components/Feedback";
import App from "./App";
import TechnicianPortal from "./portal/TechnicianPortal";
import { useSession } from "@zen/ui/lib/session";
function SessionApp() {
  const user = useSession();
  return user.papel === "tecnico" ? <TechnicianPortal /> : <App />;
}
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthGate>
      <SessionApp />
    </AuthGate>
    <Feedback />
  </StrictMode>,
);
