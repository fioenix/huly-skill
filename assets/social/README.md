# Repository social preview

`huly-social-preview.png` is a prepared 1280 × 640 PNG for GitHub's Social preview
setting. It has an opaque background and contains only product copy and synthetic
`DEMO-*` tasks. No real workspace data, performance claim, or client-count claim
is used. The source is [`preview.html`](./preview.html) with local fonts and
[`styles.css`](./styles.css), so it renders without a CDN or a build step.

The design follows the FINOLABS marketing register: Anton uppercase display,
Space Grotesk body, JetBrains Mono labels, Lab Ink neutrals, mint accents, and one
iridescent edge. Tokens are a snapshot from FINOLABS `packages/tokens/theme.css`;
fonts are the existing `@fontsource` Latin subsets, with their OFL licenses beside
them. Render at 1280 × 640, wait for `document.fonts.ready`, and capture the page.

[GitHub recommends](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)
1280 × 640 and a PNG, JPG, or GIF under 1 MB. Adding this file to the repository
alone does not change the live social preview. After owner review, upload the
PNG through repository Settings → Social preview → Edit → Upload an image.
This PR prepares the image only; it does not change that setting.
