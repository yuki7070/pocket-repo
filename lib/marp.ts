import { Marp } from "@marp-team/marp-core";

// Render a Marp Markdown deck to a self-contained HTML document. Slides use
// inline SVG so they scale to the viewport — good for a narrow phone preview.
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
${css}
</style>
</head>
<body>
${html}
</body>
</html>`;
}
