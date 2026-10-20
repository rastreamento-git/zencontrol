import { lazy, Suspense } from "react";
import TrackingHome from "./TrackingHome";
const ZenControl = lazy(() => import("./App"));
export default function TrackingEntry() {
  const control =
    window.location.pathname === "/zencontrol" ||
    window.location.pathname.startsWith("/zencontrol/");
  return control ? (
    <Suspense
      fallback={
        <main className="tracking-main" role="status">
          Carregando ZenControl…
        </main>
      }
    >
      <ZenControl />
    </Suspense>
  ) : (
    <TrackingHome />
  );
}
