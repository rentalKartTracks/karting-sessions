chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Store videos or shorts (merges with existing, keyed by videoId)
  if (message.action === "storeVideos") {
    chrome.storage.local.get(['scheduledVideos', 'scheduledShorts'], function(data) {
      const incoming = message.videos || [];
      const type = message.contentType; // "video" | "short"
      const storageKey = type === "short" ? 'scheduledShorts' : 'scheduledVideos';
      const existing = data[storageKey] || [];

      // Merge by videoId, incoming overwrites existing
      const existingMap = {};
      existing.forEach(v => { if (v.videoId) existingMap[v.videoId] = v; });
      incoming.forEach(v => { if (v.videoId) existingMap[v.videoId] = v; });
      const merged = Object.values(existingMap);

      chrome.storage.local.set({ [storageKey]: merged }, () => {
        sendResponse({ status: "success", count: merged.length });
      });
    });
    return true;
  }

  // Navigate to videos upload page
  if (message.action === "openVideosPage") {
    const channelId = message.channelId;
    const url = channelId
      ? `https://studio.youtube.com/channel/${channelId}/videos/upload?filter=%5B%5D&sort=%7B%22columnType%22%3A%22date%22%2C%22sortOrder%22%3A%22DESCENDING%22%7D`
      : `https://studio.youtube.com/`;
    chrome.tabs.create({ url }, (tab) => sendResponse({ status: "success", tabId: tab.id }));
    return true;
  }

  // Navigate to shorts page
  if (message.action === "openShortsPage") {
    const channelId = message.channelId;
    const url = channelId
      ? `https://studio.youtube.com/channel/${channelId}/videos/short?filter=%5B%5D&sort=%7B%22columnType%22%3A%22date%22%2C%22sortOrder%22%3A%22DESCENDING%22%7D`
      : `https://studio.youtube.com/`;
    chrome.tabs.create({ url }, (tab) => sendResponse({ status: "success", tabId: tab.id }));
    return true;
  }

  // Legacy: open arbitrary URL in new tab
  if (message.action === "openVideoEditor") {
    chrome.tabs.create({ url: message.url });
    sendResponse({ status: "success" });
    return true;
  }

  // Get channelId from any open studio tab
  if (message.action === "getChannelId") {
    chrome.tabs.query({ url: "https://studio.youtube.com/*" }, (tabs) => {
      let channelId = null;
      for (const tab of tabs) {
        const match = tab.url && tab.url.match(/studio\.youtube\.com\/channel\/([^\/\?]+)/);
        if (match && !match[1].startsWith('video')) { channelId = match[1]; break; }
      }
      sendResponse({ channelId });
    });
    return true;
  }
});
