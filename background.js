/*
 * DOMPick Helper Toggle Service Worker (Manifest V3)
 * -------------------------------------------------
 * Event flow overview:
 * 1. User clicks the action icon.
 *    - Toggle ON/OFF state for current tab.
 *    - ON: inject helper.js into page (world: MAIN).
 *    - OFF: send DOMPICK_DISABLE message to content script to close panel.
 * 2. When a tab with ON state finishes loading (tabs.onUpdated status "complete"),
 *    the helper is reinjected automatically.
 * 3. Tab state is stored both in-memory and in chrome.storage.session so that
 *    it survives service worker restarts.
 * 4. Tab replacement (tabs.onReplaced) transfers or clears state to avoid
 *    leaking ON flags for old tabIds.
 * 5. Closing a tab cleans up its state.
 */

const tabStates = new Map(); // tabId -> boolean

initState();

// Restore state from chrome.storage.session when the service worker starts.
async function initState() {
  const stored = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(stored)) {
    const id = Number(key);
    tabStates.set(id, value);
    updateAction(id); // restore icon/badge
  }
}

// Utility to check if a tab's URL is restricted
function isForbidden(tab) {
  const url = tab.url || "";
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("https://chrome.google.com/webstore")
  );
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  if (isForbidden(tab)) {
    updateAction(tab.id, true);
    return;
  }
  const current = tabStates.get(tab.id) === true;
  const next = !current;
  await setTabState(tab.id, next);
  if (next) {
    injectHelper(tab.id);
  } else {
    chrome.tabs.sendMessage(tab.id, { type: "DOMPICK_DISABLE" }).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tabStates.get(tabId)) {
    injectHelper(tabId);
  }
});

// When a tab is replaced (e.g., prerendered or restored), move any ON state
// from the old tabId to the new one and inject if necessary.
chrome.tabs.onReplaced.addListener(async (addedId, removedId) => {
  const wasOn = tabStates.get(removedId);
  tabStates.delete(removedId);
  chrome.storage.session.remove(removedId.toString());
  if (wasOn) {
    tabStates.set(addedId, true);
    await chrome.storage.session.set({ [addedId]: true });
    injectHelper(addedId);
  } else {
    updateAction(addedId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  chrome.storage.session.remove(tabId.toString());
});

async function setTabState(tabId, isOn) {
  tabStates.set(tabId, isOn);
  await chrome.storage.session.set({ [tabId]: isOn });
  updateAction(tabId);
}

function updateAction(tabId, err = false) {
  const isOn = tabStates.get(tabId);
  const base = isOn ? "icons/icon_on" : "icons/icon";
  chrome.action.setIcon({
    tabId,
    path: {
      16: `${base}16.png`,
      32: `${base}32.png`,
      48: `${base}48.png`,
      128: `${base}128.png`,
    },
  });
  chrome.action.setBadgeText({ tabId, text: err ? "ERR" : isOn ? "ON" : "" });
}

async function injectHelper(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isForbidden(tab)) {
      updateAction(tabId, true);
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["helper.js"],
    });
    updateAction(tabId);
  } catch (e) {
    console.warn("Injection failed", e);
    updateAction(tabId, true);
  }
}
