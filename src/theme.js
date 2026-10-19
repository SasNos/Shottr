const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Sets `data-theme` on the root element from the system appearance and follows its changes, like Mber Flow's
 * "system" setting. theme.css defines light in `:root` and dark in `:root[data-theme='dark']`.
 * Inside Spark the host sets `data-theme` itself and this function is not called.
 */
export function applyTheme(document, matchMedia) {
  const query = matchMedia(DARK_QUERY);
  const apply = () => {
    document.documentElement.dataset.theme = query.matches ? 'dark' : 'light';
  };
  apply();
  query.addEventListener('change', apply);
}
