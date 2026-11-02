// Node 22+ and Firefox. Run from any directory: node subtitle-masker/tests/browser.mjs
// Uses an isolated profile under .test-artifacts, never your normal Firefox profile.
import assert from "node:assert/strict";
import {readFile, mkdir, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifacts = path.join(root, ".test-artifacts");
await mkdir(path.join(artifacts, "profile"), {recursive: true});
// Headless Firefox has no native window to fullscreen. Keep DOM fullscreen behavior.
await writeFile(path.join(artifacts, "profile", "user.js"), 'user_pref("full-screen-api.ignore-widgets", true);\nuser_pref("full-screen-api.allow-trusted-requests-only", false);\nuser_pref("full-screen-api.warning.timeout", 0);\n');
const server = createServer(async (req, res) => {
  const routes = {"/": "tests/player.html", "/player.js": "tests/player.js"};
  if (!routes[req.url]) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", req.url.endsWith(".js") ? "text/javascript" : "text/html");
  res.end(await readFile(path.join(root, routes[req.url])));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = Number(process.env.MASKER_BIDI_PORT || 9223);
const firefox = spawn(process.env.FIREFOX || "firefox", ["--headless", "--no-remote", "--profile", path.join(artifacts, "profile"), "--remote-debugging-port", String(port)], {stdio: ["ignore", "ignore", "pipe"]});
let stderr = "";
firefox.stderr.on("data", (data) => { stderr += data; });
let ws, serial = 0;
const pending = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, {resolve, reject, timer});
    ws.send(JSON.stringify({id, method, params}));
  });
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
      await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
      break;
    } catch { await delay(100); }
  }
  if (ws?.readyState !== WebSocket.OPEN) throw new Error(`Firefox did not start: ${stderr}`);
  ws.onmessage = ({data}) => {
    const message = JSON.parse(data), item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.type === "error") item.reject(new Error(`${message.error}: ${message.message}`));
    else item.resolve(message.result);
  };
  await command("session.new", {capabilities: {}});
  const installed = await command("webExtension.install", {extensionData: {type: "path", path: root}});
  assert.equal(installed.extension, "subtitle-masker@local");
  console.log("PASS: Firefox installed the actual extension manifest and background script");
  const {context} = await command("browsingContext.create", {type: "tab"});
  await command("browsingContext.activate", {context});
  await command("browsingContext.navigate", {context, url: `http://127.0.0.1:${server.address().port}/`, wait: "complete"});
  async function evaluate(expression) {
    const result = await command("script.evaluate", {expression, target: {context}, awaitPromise: true, userActivation: true});
    if (result.type === "exception") throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  // Capture the closed shadow root and message listener in a fixture only. Production code is unchanged.
  await evaluate(`
    window.browser = {runtime: {onMessage: {addListener(fn) { window.testMessage = fn; }}}};
    const originalAttach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {
      const root = originalAttach.call(this, options);
      window.maskRoot = root; return root;
    };
    true;
  `);
  const source = await readFile(path.join(root, "content.js"), "utf8");
  await evaluate(source);
  await evaluate(source);
  const state = async (action, extra = {}) => JSON.parse(await evaluate(`testMessage(${JSON.stringify({source: "subtitle-masker", action, ...extra})}).then(JSON.stringify)`));
  const rect = () => evaluate(`JSON.stringify(maskRoot.getElementById('mask').getBoundingClientRect().toJSON())`).then(JSON.parse);
  const videoBounds = JSON.parse(await evaluate("JSON.stringify(video.getBoundingClientRect().toJSON())"));
  const x = Math.round(videoBounds.x + 120), y = Math.round(videoBounds.y + 285);
  async function drag(x1, y1, x2, y2) {
    await command("input.performActions", {context, actions: [{type: "pointer", id: "mouse", parameters: {pointerType: "mouse"}, actions: [
      {type: "pointerMove", x: x1, y: y1}, {type: "pointerDown", button: 0},
      {type: "pointerMove", x: x2, y: y2, duration: 150}, {type: "pointerUp", button: 0}
    ]}]});
  }
  await state("draw");
  await drag(x + 400, y + 45, x, y); // Reverse-direction elastic banding.
  assert.equal((await state("state")).exists, true);
  let b = await rect();
  assert.equal(b.width, 400); assert.equal(b.height, 45);
  assert.equal(b.x, x); assert.equal(b.y, y);
  console.log("PASS: reverse-direction rectangle drawing and idempotent injection");
  await drag(x + 100, y + 20, x + 120, y + 10);
  b = await rect(); assert.equal(b.x, x + 20); assert.equal(b.y, y - 10);
  await drag(b.right, b.bottom, b.right + 20, b.bottom + 10);
  b = await rect(); assert.equal(b.width, 420); assert.equal(b.height, 55);
  console.log("PASS: moving and corner resizing with real pointer input");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); true");
  await command("input.performActions", {context, actions: [{type: "wheel", id: "wheel", actions: [{type: "scroll", x: Math.round(b.x + 10), y: Math.round(b.y + 10), deltaX: 0, deltaY: 100}]}]});
  assert.equal((await state("state")).opacity, .95);
  assert.equal(await evaluate("scrollY"), 0);
  assert.equal((await state("toggle")).visible, false);
  assert.equal((await state("toggle")).visible, true);
  console.log("PASS: wheel opacity prevents page scrolling; hide/show keeps the mask");
  await evaluate("maskRoot.getElementById('mask').dispatchEvent(new MouseEvent('dblclick', {bubbles:true})); true");
  await drag(b.x + 100, b.y + 20, b.x + 110, b.y + 20);
  assert.equal((await rect()).x, b.x + 10);
  await drag(b.x + 110, b.y + 20, b.x + 100, b.y + 20);
  assert.equal((await rect()).x, b.x);
  console.log("PASS: Enter, double-click, and hide/show do not lock moving or resizing");
  await command("input.performActions", {context, actions: [{type: "pointer", id: "mouse", parameters: {pointerType: "mouse"}, actions: [
    {type: "pointerMove", x: b.x + 100, y: b.y + 20}, {type: "pointerDown", button: 0},
    {type: "pointerMove", x: b.x + 130, y: b.y + 20}
  ]}]});
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); true");
  await command("input.releaseActions", {context});
  assert.equal((await rect()).x, b.x);
  console.log("PASS: Escape cancels an active drag and restores the mask position");
  await evaluate("video.play().then(() => true)");
  await delay(250);
  const sampled = await state("sample");
  assert.equal(sampled.colour, "#365a70", sampled.message);
  console.log("PASS: video pixel sampling matches the generated frame colour");
  const before = await rect();
  await evaluate("document.getElementById('resize').click(); true");
  await delay(200);
  const after = await rect();
  assert.equal(after.width, before.width * .75);
  await evaluate("scrollTo(0, 50); true");
  await delay(150);
  assert.equal((await rect()).y, after.y - 50);
  await evaluate("scrollTo(0, 0); true");
  console.log("PASS: mask follows player resizing and page scrolling");
  await evaluate("player.requestFullscreen().then(() => true)");
  await delay(250);
  assert.equal(await evaluate("maskRoot.host.parentNode === document.fullscreenElement"), true);
  assert.ok((await rect()).width > after.width);
  const screenshot = await command("browsingContext.captureScreenshot", {context});
  await writeFile(path.join(artifacts, "container-fullscreen.png"), Buffer.from(screenshot.data, "base64"));
  await evaluate("document.exitFullscreen().then(() => true)");
  await delay(150);
  await evaluate("video.requestFullscreen().then(() => true)");
  await delay(150);
  assert.equal(await evaluate("getComputedStyle(maskRoot.host).display"), "none");
  assert.match((await state("state")).message, /not supported yet/);
  await evaluate("document.exitFullscreen().then(() => true)");
  console.log("PASS: container fullscreen and graceful video-element fullscreen fallback");
  await state("draw");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); true");
  assert.equal((await state("state")).exists, true);
  await command("input.performActions", {context, actions: [{type: "pointer", id: "mouse", actions: [{type: "pointerMove", x: 0, y: 0}]}]});
  assert.equal(await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Delete', bubbles:true, cancelable:true}))"), true);
  assert.equal((await state("state")).exists, true);
  const hovered = await rect();
  await command("input.performActions", {context, actions: [{type: "pointer", id: "mouse", actions: [{type: "pointerMove", x: Math.round(hovered.x + hovered.width / 2), y: Math.round(hovered.y + hovered.height / 2)}]}]});
  assert.equal(await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Delete', bubbles:true, cancelable:true}))"), false);
  assert.equal((await state("state")).exists, false);
  console.log("PASS: Delete removes a hovered mask and is left untouched elsewhere");
  await state("draw");
  await drag(x, y, x + 100, y + 30);
  assert.equal((await state("remove")).exists, false);
  console.log("PASS: cancelling redraw preserves the mask; remove clears it");

  await command("webExtension.uninstall", {extension: installed.extension});
  await command("session.end");
} finally {
  ws?.close();
  firefox.kill("SIGTERM");
  server.close();
}
