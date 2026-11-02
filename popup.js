"use strict";

let tabId;
const $ = (id) => document.getElementById(id);
async function send(action, extra = {}) {
  const state = await browser.tabs.sendMessage(tabId, {source: "subtitle-masker", action, ...extra});
  for (const id of ["toggle", "sample", "opacity", "remove"]) $(id).disabled = !state.exists;
  $("toggle").textContent = state.visible ? "Hide" : "Show";
  $("colour").value = state.colour;
  $("opacity").value = Math.round(state.opacity * 100);
  $("amount").textContent = `${Math.round(state.opacity * 100)}%`;
  $("status").hidden = !state.message;
  $("status").textContent = state.message || "";
  return state;
}
function report(error) {
  $("status").hidden = false;
  $("status").textContent = `Cannot access this page. Try a normal website tab and reload it if needed. ${error.message}`;
}
async function init() {
  try {
    const [tab] = await browser.tabs.query({active: true, currentWindow: true});
    tabId = tab.id;
    await browser.scripting.executeScript({target: {tabId}, files: ["content.js"]});
    await send("state");
    await browser.action.setBadgeText({tabId, text: ""});
    await browser.action.setTitle({tabId, title: "Subtitle Masker"});
    for (const action of ["draw", "toggle", "remove", "sample"]) {
      $(action).addEventListener("click", async () => {
        try {
          const state = await send(action);
          if (["draw", "toggle"].includes(action) && !state.message) window.close();
        } catch (error) { report(error); }
      });
    }
    $("colour").addEventListener("input", () => send("colour", {value: $("colour").value}).catch(report));
    $("opacity").addEventListener("input", () => send("opacity", {value: Number($("opacity").value) / 100}).catch(report));
  } catch (error) {
    $("draw").disabled = true;
    $("colour").disabled = true;
    report(error);
  }
}
init();
