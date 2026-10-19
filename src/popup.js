import { applyTheme } from './theme.js';

applyTheme(document, (query) => window.matchMedia(query));

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'capture', mode: button.dataset.mode });
    window.close();
  });
}
