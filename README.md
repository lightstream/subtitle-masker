# Subtitle Masker

A small Firefox extension that covers video subtitles with a movable, resizable rectangle. 
No external dependencies, accounts, or data collection.

## Load locally

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…** and select this directory's `manifest.json`.
3. Open a video page, then open **Subtitle Masker** from Firefox's Extensions menu
   (pin it to the toolbar if convenient).
4. Click **Draw mask** and drag a rectangle over the subtitles in either direction.
5. Hover over the mask to reveal its outline and eight resize handles. Drag the
   rectangle to move it, or a handle to resize it. The outline and handles hide
   when the pointer leaves and stay visible during a drag. There is no edit mode.
   **Escape** cancels drawing or an active move/resize drag. Press **Delete** while
   hovering over the mask to remove it.

Scroll over the mask to change opacity in 5% steps: wheel up conceals, wheel down
reveals. The minimum is 5% so the mask remains easy to find. The popup also provides
opacity, colour, show/hide, and remove.
**Alt+Shift+M** shows/hides the mask; if none exists it starts drawing. Firefox's
Manage Extension Shortcuts page can change this if it conflicts with a desktop shortcut.

Temporary installation lasts until Firefox restarts. After editing the source,
click **Reload** on the extension's `about:debugging` card **and reload the video tab**.
Reloading the tab clears the previous content script and mask.

Mozilla's guide: https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/

## Colour matching

**Match video colour** samples 32 source pixels just above and below the rectangle,
takes the median of each RGB channel, and applies that colour. It reads the current
frame once; it does not continuously track scene changes. The mask's opacity is
independent of its colour.

This works when the browser permits reading the video's pixels (for example,
same-origin or appropriately CORS-enabled video). Some cross-origin/protected
players block sampling. Videos inside iframes cannot be sampled by this version.
When sampling is unavailable the existing mask colour stays unchanged, and the
popup explains that a manual colour can be chosen. Matching a varied background
with one flat colour will only approximate it.

## Support and current limits

- One mask per tab/document, retained until the page reloads. No saved site presets.
- Normal webpage videos, including burned-in subtitles. A mask drawn on a video
  follows its position and size. Common centred `object-fit` letterboxing is handled.
- Container fullscreen: the overlay moves inside the fullscreen player container.
  The shortcut works without accessing the toolbar. Draw before entering fullscreen,
  or use the shortcut to start drawing there.
- Fullscreen of the `<video>` element itself is not supported yet. The mask hides
  while in that mode and returns when fullscreen ends. Picture-in-Picture is also
  outside this version's scope.
- Embedded players can be covered from the containing page; the mask follows the
  iframe's bounds. Fullscreen inside a cross-origin frame and players hidden inside
  shadow roots need further support and testing.
- Firefox internal pages, the built-in PDF viewer, and other pages where Firefox
  forbids extension injection cannot be masked.
- The mask receives mouse events so it can support wheel and editing gestures;
  controls immediately beneath it cannot be clicked until it is hidden.
- Only `activeTab` and `scripting` permissions are used: activation grants access
  to the current page rather than permanent access to all websites.

Container fullscreen has automated Firefox coverage; compatibility with individual
streaming sites still needs hands-on testing. Native video fullscreen remains the
next separate stage to investigate.

## Test

For a generated video with embedded subtitles and resize/fullscreen buttons, serve
the test page locally from this directory:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/tests/player.html`, then activate the extension normally.
The video is generated locally with a canvas stream and makes no external requests.
If autoplay is blocked, click **Play**.

The automated test requires Node 22+ (with built-in WebSocket) and Firefox on PATH:

```sh
node tests/browser.mjs
```

It launches an isolated headless Firefox profile, installs the actual extension,
and exercises the unchanged content script in a test fixture with real pointer and
wheel input. It checks drawing, resizing, moving, opacity, video sampling, player
resizing, scrolling, fullscreen transitions, cancellation, and removal. Toolbar
popup activation, `activeTab` grants, and the browser-level shortcut still need a
manual check after loading locally; the headless content-input test does not
exercise those browser UI paths. Screenshots and the isolated profile are written
to `.test-artifacts/`. The test sets headless-only fullscreen preferences in that
profile; it does not change your normal Firefox profile.

Override `FIREFOX` for another executable or `MASKER_BIDI_PORT` if port 9223 is busy.
