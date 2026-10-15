export function apiBaseUrl(value = "") {
  const root = value.trim().replace(/\/+$/, "");
  if (!root) return "/api";
  return root.endsWith("/api") ? root : `${root}/api`;
}
