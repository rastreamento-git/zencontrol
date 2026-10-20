const KEY = "zen.appearance";
const choices = ["light", "dark", "system"];
let preference = "system";
let initialized = false;

export function getAppearance() {
  return preference;
}
function apply() {
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const color = document.querySelector('meta[name="theme-color"]');
  if (color) color.content = dark ? "#101a2c" : "#f3f6fb";
  window.dispatchEvent(new Event("zen:appearance"));
}
export function setAppearance(value) {
  if (!choices.includes(value)) return;
  preference = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {}
  apply();
}
export function initializeAppearance() {
  if (initialized) return;
  initialized = true;
  try {
    const stored = localStorage.getItem(KEY);
    if (choices.includes(stored)) preference = stored;
  } catch {}
  const url = new URL(window.location.href);
  if (choices.includes(url.searchParams.get("zen_theme"))) {
    preference = url.searchParams.get("zen_theme");
    url.searchParams.delete("zen_theme");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  setAppearance(preference);
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (preference === "system") apply();
    });
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) {
      preference = choices.includes(event.newValue) ? event.newValue : "system";
      apply();
    }
  });
}
export function appearanceUrl(value) {
  if (!value) return value;
  const url = new URL(value, window.location.origin);
  url.searchParams.set("zen_theme", preference);
  return url.href;
}
