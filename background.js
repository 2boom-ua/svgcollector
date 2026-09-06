// background.js - Service Worker

let currentTabId = null;

// Enable opening sidePanel on extension icon click globally
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Error init sidebar:", error));

// Helper function to update side panel availability based on tab URL
function updateSidePanelForTab(tabId, url) {
  if (url && (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:'))) {
    // Disable side panel on restricted internal browser pages
    chrome.sidePanel.setOptions({
      tabId: tabId,
      enabled: false
    });
  } else {
    // Enable side panel for standard web pages
    chrome.sidePanel.setOptions({
      tabId: tabId,
      path: 'sidepanel.html',
      enabled: true
    });
  }
}

// Handle active tab switching
chrome.tabs.onActivated.addListener((activeInfo) => {
  currentTabId = activeInfo.tabId;
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab) {
      updateSidePanelForTab(tab.id, tab.url);
    }
  });
});

// Handle tab updates (covers browser startup and URL navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active) {
    updateSidePanelForTab(tabId, tab.url);
  }
});

// Message listener for runtime interactions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'SCAN_REQUEST') {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ error: 'No valid tab target', items: [] });
      return true;
    }

    chrome.tabs.sendMessage(tabId, { action: 'SCAN_DOM' }, (response) => {
      if (chrome.runtime.lastError) {
        // Fallback: inject content script dynamically if not present
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        }).then(() => {
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: 'SCAN_DOM' }, (res) => {
              if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message, items: [] });
                return;
              }
              sendResponse(res);
            });
          }, 100);
        }).catch((err) => {
          sendResponse({ error: err.message, items: [] });
        });
        return true;
      }
      sendResponse(response);
    });
    return true;
  }

  if (message.action === 'SCAN_RESULT') {
    chrome.runtime.sendMessage(message);
    return true;
  }

  if (message.action === 'SAVE_FILE') {
    const filename = sanitizeFilename(message.filename) || 'svg-' + Date.now() + '.svg';
    const svgCode = message.svgCode;

    // Convert SVG source to base64 data URI for download processing in Service Worker
    try {
      const base64 = btoa(unescape(encodeURIComponent(svgCode)));
      const dataUrl = 'data:image/svg+xml;base64,' + base64;

      chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: true,
        conflictAction: 'uniquify'
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ success: true, downloadId: downloadId });
      });
    } catch (err) {
      sendResponse({ error: 'Failed to encode SVG: ' + err.message });
    }
    return true;
  }
});

// Sanitize filename for local storage export
function sanitizeFilename(name) {
  if (!name) return null;
  let clean = name.replace(/[\/\\:\*\?"<>\|]/g, '_');
  clean = clean.replace(/\s+/g, '_');
  if (!clean.endsWith('.svg')) {
    clean = clean + '.svg';
  }
  return clean;
}