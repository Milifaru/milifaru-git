// Listens for disable messages and closes DOMPick panel if present.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "DOMPICK_DISABLE") {
    try {
      document.getElementById("__dompick-close")?.click();
    } catch (e) {
      // Ignore errors, panel just won't be closed.
    }
  }
});
