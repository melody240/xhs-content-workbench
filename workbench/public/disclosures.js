// Preserve the reader's explicit choices across refreshes, routes and accounts.
// This holds UI state only, in memory; it never changes task/submission state.
const choices = new Map();
const scopeOf = root => {
  const layout = root.querySelector('.layout');
  return layout ? `${layout.dataset.account}:${layout.dataset.view}` : null;
};
const keyOf = detail => detail.dataset.disclosure || detail.querySelector(':scope > summary')?.textContent.trim();

export function rememberDisclosures(root) {
  const scope = scopeOf(root);
  if (!scope) return;
  const values = choices.get(scope) || new Map();
  root.querySelectorAll('details').forEach(detail => {
    const key = keyOf(detail);
    if (key) values.set(key, detail.open);
  });
  choices.set(scope, values);
}

export function restoreDisclosures(root) {
  const values = choices.get(scopeOf(root));
  if (!values) return;
  root.querySelectorAll('details').forEach(detail => {
    const key = keyOf(detail);
    if (values.has(key)) detail.open = values.get(key);
  });
}
