import { svelte } from "@sveltejs/vite-plugin-svelte";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// dos páginas: la app (Svelte) y el editor de edits (React + Remotion, el de Lyric Edits)
export default defineConfig({
  plugins: [svelte(), react({ include: /\.tsx$/ })],
  clearScreen: false,
  server: { port: 1440, strictPort: true, host: "127.0.0.1", watch: { ignored: ["**/src-tauri/**"] } },
  build: {
    target: "es2022",
    rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), edit: resolve(import.meta.dirname, "edit.html") } },
  },
});
