// Exporta un edit a MP4 con Remotion. Lo lanza la cola de Estudio (recurso «render»):
//   node render.mjs <props.json> <salida.mp4>
// Eventos JSON lines por stdout, como el motor: pct y al final done/error.
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const emit = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));
const [propsFile, out] = process.argv.slice(2);
const root = import.meta.dirname;
const entry = resolve(root, "src/edit/remotion/index.ts");

/** El bundle de Remotion tarda (webpack): se guarda y solo se rehace si cambian las plantillas. */
async function serveUrl() {
  const src = resolve(root, "src/edit/remotion");
  const stamp = String(Math.max(...readdirSync(src, { recursive: true }).map((f) => statSync(join(src, f)).mtimeMs)));
  const dir = resolve(root, "node_modules/.cache/estudio-remotion");
  if (existsSync(join(dir, "stamp")) && readFileSync(join(dir, "stamp"), "utf8") === stamp) return dir;
  emit("progress", { step: 1, total: 2, label: "Preparando plantillas" });
  rmSync(dir, { recursive: true, force: true });
  await bundle({ entryPoint: entry, outDir: dir });
  writeFileSync(join(dir, "stamp"), stamp);
  return dir;
}

try {
  const props = JSON.parse(readFileSync(propsFile, "utf8"));
  const url = await serveUrl();
  const composition = await selectComposition({ serveUrl: url, id: "LyricEdit", inputProps: props });
  mkdirSync(resolve(out, ".."), { recursive: true });
  emit("progress", { step: 2, total: 2, label: "Renderizando" });
  let last = -1;
  await renderMedia({
    composition,
    serveUrl: url,
    codec: "h264",
    crf: 18,
    inputProps: props,
    outputLocation: out,
    onProgress: ({ progress }) => {
      const p = Math.round(progress * 100);
      if (p !== last) emit("pct", { value: (last = p) });
    },
  });
  rmSync(propsFile, { force: true });
  emit("done", { path: out });
} catch (e) {
  emit("error", { message: e?.message ?? String(e) });
  process.exit(1);
}
