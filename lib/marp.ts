import { Marp } from "@marp-team/marp-core";

// Client-side controller injected into the rendered deck. It adds a fullscreen
// slideshow mode on top of the default scrollable view: one slide at a time,
// driven by keyboard (arrows / space / Home / End / Esc), tap zones, and the
// Fullscreen API. Written without template literals so it can be embedded in
// the outer template string verbatim.
const SLIDESHOW_CONTROLLER = [
  "(function () {",
  "  var slides = Array.prototype.slice.call(document.querySelectorAll('.marpit > svg'));",
  "  if (!slides.length) return;",
  "  var idx = 0, active = false;",
  "  var counter = document.getElementById('mp-counter');",
  "  function clamp(n) { return Math.max(0, Math.min(slides.length - 1, n)); }",
  "  function show(n) {",
  "    idx = clamp(n);",
  "    for (var i = 0; i < slides.length; i++) {",
  "      slides[i].classList.toggle('mp-current', i === idx && active);",
  "    }",
  "    if (counter) counter.textContent = (idx + 1) + ' / ' + slides.length;",
  "  }",
  "  function enter() {",
  "    active = true;",
  "    document.body.classList.add('mp-show');",
  "    show(idx);",
  "    var el = document.documentElement;",
  "    if (el.requestFullscreen) { el.requestFullscreen().catch(function () {}); }",
  "  }",
  "  function exit() {",
  "    active = false;",
  "    document.body.classList.remove('mp-show');",
  "    for (var i = 0; i < slides.length; i++) slides[i].classList.remove('mp-current');",
  "    if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(function () {}); }",
  "  }",
  "  function next() { if (active) show(idx + 1); }",
  "  function prev() { if (active) show(idx - 1); }",
  "  var playBtn = document.getElementById('mp-play');",
  "  var exitBtn = document.getElementById('mp-exit');",
  "  if (playBtn) playBtn.addEventListener('click', enter);",
  "  if (exitBtn) exitBtn.addEventListener('click', exit);",
  "  document.addEventListener('keydown', function (e) {",
  "    if (!active) { if (e.key === 'f' || e.key === 'F') enter(); return; }",
  "    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { next(); e.preventDefault(); }",
  "    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { prev(); e.preventDefault(); }",
  "    else if (e.key === 'Home') { show(0); e.preventDefault(); }",
  "    else if (e.key === 'End') { show(slides.length - 1); e.preventDefault(); }",
  "    else if (e.key === 'Escape') { exit(); }",
  "  });",
  "  document.addEventListener('click', function (e) {",
  "    if (!active) return;",
  "    if (e.target.closest && e.target.closest('#mp-toolbar')) return;",
  "    if (e.clientX < window.innerWidth * 0.33) prev(); else next();",
  "  });",
  "  document.addEventListener('fullscreenchange', function () {",
  "    if (!document.fullscreenElement && active) exit();",
  "  });",
  "})();"
].join("\n");

// Render a Marp Markdown deck to a self-contained HTML document. Slides use
// inline SVG so they scale to the viewport — good for a narrow phone preview —
// and a fullscreen slideshow mode is available via the injected controller.
export function renderMarpDeck(markdown: string, title: string) {
  const marp = new Marp({ inlineSVG: true, html: false });
  const { html, css } = marp.render(markdown);
  const safeTitle = title.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style>
html, body { margin: 0; padding: 0; background: #1a1a1a; }
.marpit { padding: 12px; }
.marpit > svg { display: block; width: 100%; height: auto; margin: 0 auto 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.35); }

/* Slideshow toolbar */
#mp-toolbar {
  position: fixed; top: 10px; right: 10px; z-index: 2147483647;
  display: flex; gap: 8px; align-items: center;
  font-family: system-ui, -apple-system, sans-serif;
}
#mp-toolbar button {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border: none; border-radius: 999px; cursor: pointer;
  font-size: 13px; font-weight: 600; color: #fff;
  background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(6px);
}
#mp-toolbar button:hover { background: rgba(0, 0, 0, 0.75); }
#mp-counter {
  color: #fff; font-size: 13px; font-variant-numeric: tabular-nums;
  padding: 5px 11px; border-radius: 999px; background: rgba(0, 0, 0, 0.55);
}
#mp-toolbar #mp-counter, #mp-toolbar #mp-exit { display: none; }
body.mp-show #mp-toolbar #mp-play { display: none; }
body.mp-show #mp-toolbar #mp-counter,
body.mp-show #mp-toolbar #mp-exit { display: inline-flex; }

/* Slideshow (one slide, full viewport) */
body.mp-show { background: #000; overflow: hidden; cursor: pointer; }
body.mp-show .marpit { padding: 0; margin: 0; }
body.mp-show .marpit > svg { display: none !important; }
body.mp-show .marpit > svg.mp-current {
  display: block !important; position: fixed; inset: 0;
  width: 100vw; height: 100vh; margin: 0; box-shadow: none;
}
${css}
</style>
</head>
<body>
<div id="mp-toolbar">
  <button id="mp-play" type="button">▶ Slideshow</button>
  <span id="mp-counter"></span>
  <button id="mp-exit" type="button">✕ Exit</button>
</div>
${html}
<script>
${SLIDESHOW_CONTROLLER}
</script>
</body>
</html>`;
}
