"use strict";

browser.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-mask") return;
  const [tab] = await browser.tabs.query({active: true, currentWindow: true});
  if (!tab?.id) return;
  try {
    await browser.scripting.executeScript({target: {tabId: tab.id}, files: ["content.js"]});
    await browser.tabs.sendMessage(tab.id, {source: "subtitle-masker", action: "toggle"});
    await browser.action.setBadgeText({tabId: tab.id, text: ""});
  } catch {
    await browser.action.setBadgeText({tabId: tab.id, text: "!"});
    await browser.action.setTitle({tabId: tab.id, title: "Subtitle Masker cannot run on this page. Open its popup for details."});
  }
});
