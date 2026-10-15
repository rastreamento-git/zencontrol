export function notify(message, kind = "info") {
  window.dispatchEvent(
    new CustomEvent("invent:notice", { detail: { message, kind } }),
  );
}
export function confirmAction(
  description,
  { title = "Confirmar ação", confirmLabel = "Confirmar", danger = false } = {},
) {
  return new Promise((resolve) =>
    window.dispatchEvent(
      new CustomEvent("invent:confirm", {
        detail: { description, title, confirmLabel, danger, resolve },
      }),
    ),
  );
}
