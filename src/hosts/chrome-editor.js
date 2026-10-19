// Chrome host for the editor: the capture job comes from chrome.storage (key in the page URL), Cancel closes the tab.
// Spark provides the same functions through its own commands and dialogs (docs/SPARK.md).
import { jobKey } from '../job.js';

/** Creates the editor host for initEditor() in a Chrome extension. `confirm` is the browser's confirm(). */
export function createChromeEditorHost({ chrome, location, confirm }) {
  return {
    async loadJob() {
      const id = new URLSearchParams(location.search).get('job');
      if (!id) return null;
      const key = jobKey(id);
      const stored = await chrome.storage.local.get(key);
      await chrome.storage.local.remove(key);
      return stored[key] ?? null;
    },

    async confirmDiscard(message) {
      return confirm(message);
    },

    async close() {
      const tab = await chrome.tabs.getCurrent();
      await chrome.tabs.remove(tab.id);
    },
  };
}
