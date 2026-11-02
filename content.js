(() => {
  "use strict";
  // executeScript runs on every popup/shortcut invocation; keep one controller per document.
  if (globalThis.__subtitleMasker) return;
  globalThis.__subtitleMasker = true;

  const host = document.createElement("div");
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;z-index:2147483647!important;pointer-events:none!important;";
  const shadow = host.attachShadow({mode: "closed"});
  shadow.innerHTML = `
    <style>
      :host { color-scheme: dark; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      #surface { position: absolute; inset: 0; pointer-events: none; }
      #surface.drawing { pointer-events: auto; cursor: crosshair; touch-action: none; }
      #mask { position: absolute; pointer-events: auto; touch-action: none; cursor: move; }
      #surface.drawing #mask { cursor: crosshair; }
      #surface:not(.drawing) #mask:hover, #surface:not(.drawing) #mask.dragging { outline: 1px dashed white; box-shadow: 0 0 0 2px #222; }
      #fill { position: absolute; inset: 0; pointer-events: none; }
      #handles { position: absolute; inset: 0; pointer-events: none; visibility: hidden; }
      #mask:hover #handles, #mask.dragging #handles { visibility: visible; }
      .handle { position: absolute; width: 12px; height: 12px; background: white; border: 2px solid #263547; pointer-events: auto; transform: translate(-50%, -50%); }
      #hint { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); padding: 9px 14px; border-radius: 5px; background: #18232fee; color: white; font: 14px system-ui,sans-serif; pointer-events: none; white-space: nowrap; }
    </style>
    <div id="surface">
      <div id="mask" hidden><div id="fill"></div><div id="handles" hidden></div></div>
      <div id="hint" hidden></div>
    </div>`;
  const $ = (id) => shadow.getElementById(id);
  const surface = $("surface"), mask = $("mask"), fill = $("fill"), handles = $("handles"), hint = $("hint");
  for (const [edge, x, y, cursor] of [
    ["nw", 0, 0, "nwse-resize"], ["n", 50, 0, "ns-resize"], ["ne", 100, 0, "nesw-resize"],
    ["e", 100, 50, "ew-resize"], ["se", 100, 100, "nwse-resize"], ["s", 50, 100, "ns-resize"],
    ["sw", 0, 100, "nesw-resize"], ["w", 0, 50, "ew-resize"]
  ]) {
    const handle = document.createElement("div");
    handle.className = "handle";
    handle.dataset.edge = edge;
    handle.style.cssText = `left:${x}%;top:${y}%;cursor:${cursor}`;
    handles.append(handle);
  }

  let rect = null, anchor = null, relative = null;
  let visible = true, drawing = false, drag = null;
  let colour = "#000000", opacity = 1, hintTimer;
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const point = (event) => ({x: clamp(event.clientX, 0, innerWidth), y: clamp(event.clientY, 0, innerHeight)});
  const fromPoints = (a, b) => ({x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y)});

  function anchorBounds(element) {
    const b = element.getBoundingClientRect();
    if (element.tagName !== "VIDEO" || !element.videoWidth || !element.videoHeight) return b;
    const style = getComputedStyle(element);
    const vw = element.videoWidth, vh = element.videoHeight;
    let width = b.width, height = b.height;
    if (style.objectFit !== "fill" && style.objectPosition === "50% 50%") {
      const sx = b.width / vw, sy = b.height / vh;
      const scale = style.objectFit === "cover" ? Math.max(sx, sy) : style.objectFit === "none" ? 1 : style.objectFit === "scale-down" ? Math.min(1, sx, sy) : Math.min(sx, sy);
      width = vw * scale; height = vh * scale;
    }
    return {x: b.x + (b.width - width) / 2, y: b.y + (b.height - height) / 2, width, height};
  }

  function mount() {
    const fullscreen = document.fullscreenElement;
    // A video element cannot render overlay children. Leave that case for a later stage.
    const supported = !fullscreen || !["VIDEO", "IFRAME"].includes(fullscreen.tagName);
    const parent = supported && fullscreen ? fullscreen : document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
    host.style.setProperty("display", supported ? "block" : "none", "important");
    return supported;
  }
  function showHint(text, temporary = false) {
    clearTimeout(hintTimer);
    hint.textContent = text;
    hint.hidden = !text;
    if (temporary) hintTimer = setTimeout(() => { hint.hidden = true; }, 1800);
  }
  function render() {
    mask.hidden = !rect || !visible;
    if (rect) Object.assign(mask.style, {left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`});
    fill.style.background = colour;
    fill.style.opacity = opacity;
    mask.classList.toggle("dragging", Boolean(drag));
    handles.hidden = drawing;
    surface.classList.toggle("drawing", drawing);
  }
  function saveRelative() {
    if (!anchor || !rect) { relative = null; return; }
    const bounds = anchorBounds(anchor);
    if (!bounds.width || !bounds.height) return;
    relative = {x: (rect.x - bounds.x) / bounds.width, y: (rect.y - bounds.y) / bounds.height, width: rect.width / bounds.width, height: rect.height / bounds.height};
  }
  function selectAnchor() {
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    // Embedded players can be covered without asking for access to their frame's origin.
    anchor = [...document.querySelectorAll("video, iframe")].filter((element) => {
      const b = element.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    }).sort((a, b) => {
      const aa = a.getBoundingClientRect(), bb = b.getBoundingClientRect();
      return aa.width * aa.height - bb.width * bb.height;
    })[0] || null;
    saveRelative();
  }
  function followAnchor() {
    if (!rect || drag || drawing) return;
    if (anchor?.isConnected && relative) {
      const b = anchorBounds(anchor);
      rect = {x: b.x + relative.x * b.width, y: b.y + relative.y * b.height, width: relative.width * b.width, height: relative.height * b.height};
      mask.hidden = !visible || !b.width || !b.height;
      Object.assign(mask.style, {left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`});
    } else if (anchor) {
      mask.hidden = true;
    }
  }
  // Player layouts can change without a window resize (e.g. theatre mode).
  setInterval(followAnchor, 100);
  window.addEventListener("scroll", followAnchor, {passive: true, capture: true});
  window.addEventListener("resize", followAnchor, {passive: true});
  document.addEventListener("fullscreenchange", () => { mount(); followAnchor(); });

  function cancelInteraction() {
    if (drag) {
      rect = drag.original;
      if (surface.hasPointerCapture(drag.pointerId)) surface.releasePointerCapture(drag.pointerId);
    }
    drawing = false;
    drag = null;
    showHint("");
    render();
  }
  function removeMask() {
    cancelInteraction();
    rect = null;
    anchor = null;
    relative = null;
    render();
  }
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (!drawing && (!rect || !visible))) return;
    event.preventDefault();
    event.stopPropagation();
    const start = point(event);
    drag = {start, original: rect && {...rect}, edge: event.target.dataset.edge, draw: drawing, pointerId: event.pointerId};
    if (drawing) { rect = fromPoints(start, start); visible = true; }
    surface.setPointerCapture(event.pointerId);
    render();
  });
  surface.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const p = point(event), o = drag.original;
    if (drag.draw) rect = fromPoints(drag.start, p);
    else if (!drag.edge) {
      rect = {...o, x: clamp(o.x + p.x - drag.start.x, 0, Math.max(0, innerWidth - o.width)), y: clamp(o.y + p.y - drag.start.y, 0, Math.max(0, innerHeight - o.height))};
    } else {
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      let left = o.x, right = o.x + o.width, top = o.y, bottom = o.y + o.height;
      if (drag.edge.includes("w")) left = clamp(o.x + dx, 0, right - 8);
      if (drag.edge.includes("e")) right = clamp(o.x + o.width + dx, left + 8, innerWidth);
      if (drag.edge.includes("n")) top = clamp(o.y + dy, 0, bottom - 8);
      if (drag.edge.includes("s")) bottom = clamp(o.y + o.height + dy, top + 8, innerHeight);
      rect = {x: left, y: top, width: right - left, height: bottom - top};
    }
    render();
  });
  surface.addEventListener("pointerup", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (rect.width < 8 || rect.height < 8) rect = drag.original;
    drag = null;
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    drawing = false;
    if (rect) selectAnchor();
    showHint("");
    render();
  });
  surface.addEventListener("pointercancel", () => {
    cancelInteraction();
  });
  // Stop clicks on the mask from reaching a player that toggles playback on click.
  surface.addEventListener("click", (event) => event.stopPropagation());
  mask.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  mask.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.deltaY) return;
    opacity = Math.round(clamp(opacity + (event.deltaY < 0 ? .05 : -.05), .05, 1) * 100) / 100;
    showHint(`Opacity ${Math.round(opacity * 100)}%`, true);
    render();
  }, {passive: false});
  document.addEventListener("keydown", (event) => {
    if (event.key === "Delete" && rect && visible && !drawing && mask.matches(":hover")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      removeMask();
      return;
    }
    if ((!drawing && !drag) || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelInteraction();
  }, true);

  function sampleColour() {
    if (!rect || anchor?.tagName !== "VIDEO") return "Draw the mask over a video on this page first. Embedded frames cannot be sampled.";
    if (anchor.readyState < 2) return "Play the video first, then try matching its colour.";
    // Map viewport coordinates into source pixels, allowing for object-fit letterboxing.
    const b = anchorBounds(anchor), style = getComputedStyle(anchor);
    if (style.objectPosition !== "50% 50%" || !["contain", "cover", "fill", "scale-down", "none"].includes(style.objectFit)) {
      return "This player's video positioning is not supported for sampling. Choose a colour manually.";
    }
    const vw = anchor.videoWidth, vh = anchor.videoHeight;
    const sx = b.width / vw, sy = b.height / vh;
    const ox = b.x, oy = b.y;
    const canvas = document.createElement("canvas");
    canvas.width = 16; canvas.height = 2;
    const ctx = canvas.getContext("2d", {willReadFrequently: true});
    try {
      // Sample above and below the mask, avoiding the subtitles inside it.
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 16; i++) {
          const x = rect.x + (i + .5) * rect.width / 16;
          const y = row === 0 ? rect.y - 4 : rect.y + rect.height + 4;
          if (x < ox || x >= ox + vw * sx || y < oy || y >= oy + vh * sy) {
            ctx.fillStyle = "black"; ctx.fillRect(i, row, 1, 1);
          } else {
            ctx.drawImage(anchor, clamp((x - ox) / sx, 0, vw - 1), clamp((y - oy) / sy, 0, vh - 1), 1, 1, i, row, 1, 1);
          }
        }
      }
      const pixels = ctx.getImageData(0, 0, 16, 2).data;
      const rgb = [0, 1, 2].map((channel) => {
        const values = [];
        for (let i = channel; i < pixels.length; i += 4) values.push(pixels[i]);
        values.sort((a, b) => a - b);
        return Math.round((values[15] + values[16]) / 2);
      });
      colour = `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
      render();
      return "Matched the current frame. Match again when the scene changes.";
    } catch {
      return "This video blocks pixel sampling. Choose a colour manually.";
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.source !== "subtitle-masker") return;
    const supported = mount();
    let feedback = supported ? "" : "Exit fullscreen to draw a mask. Fullscreen of the video element itself is not supported yet.";
    switch (message.action) {
      case "draw":
        if (supported) {
          cancelInteraction(); drawing = true;
          showHint("Drag a rectangle over the subtitles · Esc cancels");
        }
        break;
      case "toggle":
        cancelInteraction();
        if (rect) { visible = !visible; }
        else if (supported) { drawing = true; showHint("Drag a rectangle over the subtitles · Esc cancels"); }
        break;
      case "remove": removeMask(); break;
      case "colour": if (/^#[0-9a-f]{6}$/i.test(message.value)) colour = message.value; break;
      case "opacity": if (Number.isFinite(message.value)) opacity = clamp(message.value, .05, 1); break;
      case "sample": feedback = sampleColour(); break;
    }
    render();
    return Promise.resolve({exists: Boolean(rect), visible: Boolean(rect) && visible, colour, opacity, message: feedback});
  });
})();
