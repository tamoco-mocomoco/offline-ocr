import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";

/**
 * Vite places HTML inputs at their original relative path inside the output
 * directory (so `src/offscreen/offscreen.html` ends up at
 * `dist/src/offscreen/offscreen.html`). The Chrome extension manifest expects
 * those files at the dist root, so this plugin moves them after the build.
 *
 * It also deletes the duplicate ORT wasm that Vite emits into `dist/assets/`
 * when bundling onnxruntime-web — we ship our own copy in `public/ort/` which
 * the worker loads via `ort.env.wasm.wasmPaths`.
 */
function postBuildLayout(): Plugin {
  return {
    name: "ndlocr-lite-post-build-layout",
    apply: "build",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      const moves: Array<[string, string]> = [
        ["src/offscreen/offscreen.html", "offscreen.html"],
        ["src/popup/popup.html", "popup.html"],
        ["src/options/options.html", "options.html"],
      ];
      for (const [from, to] of moves) {
        const src = resolve(dist, from);
        const dest = resolve(dist, to);
        if (existsSync(src)) {
          mkdirSync(resolve(dest, ".."), { recursive: true });
          renameSync(src, dest);
          // Rewrite relative asset URLs that were correct for the original
          // nested location (e.g. ../../assets/foo.js) so they resolve from
          // the dist root after the move.
          const html = readFileSync(dest, "utf8").replaceAll(
            "../../assets/",
            "assets/",
          );
          writeFileSync(dest, html);
        }
      }
      // Clean up the now-empty `dist/src` tree
      const srcDir = resolve(dist, "src");
      if (existsSync(srcDir)) rmSync(srcDir, { recursive: true, force: true });

      // Copy icons/ (project root) → dist/icons/ with the names manifest expects.
      // The source files use bare names (16.png, 48.png, 128.png); the manifest
      // references icon16.png, icon32.png, icon48.png, icon128.png.
      const iconsRoot = resolve(__dirname, "icons");
      const iconsDist = resolve(dist, "icons");
      if (existsSync(iconsRoot)) {
        mkdirSync(iconsDist, { recursive: true });
        const mapping: Array<[string, string]> = [
          ["16.png", "icon16.png"],
          ["48.png", "icon32.png"],  // 32px uses 48px source (no 32px provided)
          ["48.png", "icon48.png"],
          ["128.png", "icon128.png"],
        ];
        for (const [src, dest] of mapping) {
          const s = resolve(iconsRoot, src);
          if (existsSync(s)) copyFileSync(s, resolve(iconsDist, dest));
        }
      }

    },
  };
}

/**
 * Vite build for the Chrome extension.
 *
 * Multi-entry build:
 *  - background service worker  → dist/background.js
 *  - content script              → dist/content.js
 *  - offscreen document HTML+JS  → dist/offscreen.html + dist/offscreen.js
 *  - popup HTML+JS               → dist/popup.html + dist/popup.js
 *
 * The OCR Web Worker is referenced via `new Worker(new URL(...), { type: "module" })`
 * inside src/offscreen/offscreen.ts and is automatically code-split by Vite.
 *
 * Static assets in `public/` (manifest.json, models/, ort/, icons/) are copied as-is.
 */
export default defineConfig({
  // Use relative paths so chrome-extension:// resolves correctly
  base: "./",
  plugins: [postBuildLayout()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/service-worker.ts"),
        content: resolve(__dirname, "src/content/content.ts"),
        offscreen: resolve(__dirname, "src/offscreen/offscreen.html"),
        popup: resolve(__dirname, "src/popup/popup.html"),
        options: resolve(__dirname, "src/options/options.html"),
      },
      output: {
        // Stable, predictable filenames so manifest.json can reference them
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "content") return "content.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
});
