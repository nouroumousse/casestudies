# Case Study Studio

A browser-based, local-first tool for turning existing brand assets into two editable, portfolio-ready case study pages.

## What it does

- Accepts a logo SVG or app-icon SVG, sanitizes it before preview, preserves the original upload for download, and keeps the rendered mark's proportions intact.
- Captures labelled brand colours, a font family name, and an optional licensed font file.
- Collects brand, client, project and optional context details without requiring invented background.
- Creates two distinct responsive directions: **Editorial / Studio** and **Immersive / Art-directed**.
- Lets you edit copy, reorder or hide sections, add custom sections, regenerate a direction or individual section, and add captions and alt text to project images.
- Builds illustrative CSS application concepts and labels them as concepts, never as confirmed client deliverables.
- Stores projects and uploaded files locally in IndexedDB (with a localStorage fallback).
- Exports a self-contained HTML page, a ZIP containing that page, or a print-ready PDF through the browser.
- Includes an optional server-side AI copy suggestion endpoint. Without an API key, local factual copy suggestions remain available.

## Run locally

The application is browser-first and has no front-end build step. For the static workspace, serve this folder from any local web server. To test the optional serverless API locally:

```bash
npx vercel dev
```

Then open the local URL shown by Vercel. The AI status endpoint is `/api/status`. Alternatively, serve the folder with any static HTTP server to use the local-only workspace (AI routes require the Vercel function runtime).

## Optional AI configuration

Set these environment variables in your Vercel project settings (or local environment):

- `OPENAI_API_KEY` — server-only API key. Never add this to browser code.
- `OPENAI_MODEL` — optional model override; defaults to `gpt-4.1-mini`.
- `OPENAI_BASE_URL` — optional OpenAI-compatible API base URL; defaults to `https://api.openai.com/v1`. This makes the text provider endpoint configurable without changing browser code.

The API route sends only the selected section and the project facts supplied by the user. It asks for a factual copy revision and validates the response shape before returning it. If no key is configured, the app stays in local mode and does not claim to have used AI.

## Deploy to Vercel

1. Import this repository into Vercel.
2. Choose **Other** as the framework preset. No build command is needed; use `.` as the output directory if the setup asks for one.
3. Deploy. Vercel serves `index.html`, `styles.css` and `app.js` as static assets and exposes the `/api` functions as serverless routes.
4. To enable optional AI copy suggestions, add `OPENAI_API_KEY` in Project Settings → Environment Variables and redeploy. `OPENAI_MODEL` is optional.

## Privacy and limitations

- The browser does not upload brand assets to a server. Projects and imagery stay in local browser storage unless you export them.
- Brand websites are not fetched or scraped. A provided URL is only included as a reference link; upload screenshots for actual website work.
- The browser-built applications are illustrative visual concepts. They are not represented as real client work.
- An uploaded font is embedded only after the user confirms permission. If no font file is included, the case study uses the named font if installed, then falls back to the system stack.
- The exported ZIP currently contains one self-contained `index.html`; SVGs, photos and permitted fonts are embedded into that document.
- PDF export opens the browser print dialog. Choose “Save as PDF” in the destination options.
- Sharing URLs and hosted project storage are not provided because this version has no publishing backend.

## Keyboard and accessibility

The workspace uses semantic controls, visible focus states and reduced-motion styles. In the case-study editor, use `Ctrl/Cmd + Z` to undo section edits and `Ctrl/Cmd + Shift + Z` to redo them. The generated pages use semantic headings, descriptive image text and responsive layouts.