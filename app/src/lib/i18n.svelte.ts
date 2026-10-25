import { STEM_INFO } from "./engine";
import { settings } from "./settings.svelte";
import { en } from "./locales/en.ts";
import { zh } from "./locales/zh.ts";

export type Lang = "es" | "en" | "zh";

/** Idiomas de Ajustes. El español es la lengua de origen: la clave de cada traducción es su texto. */
export const LANGS: { value: Lang; label: string }[] = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
];

const DICTS: Partial<Record<Lang, Record<string, string>>> = { en, zh };

/** Traduce un texto español (la clave) al idioma de Ajustes, sustituyendo {param}. Sin traducción: el propio texto. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = DICTS[settings.lang]?.[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Traduce una etiqueta que llega del motor (Python o Rust) tal cual: primero diccionario exacto, luego plantillas. */
export function engineLabel(s: string): string {
  if (!s) return s;
  const d = DICTS[settings.lang];
  if (d?.[s]) return d[s];
  let m = s.match(/^Bajando (\d+) ficheros?$/);
  if (m) return t(+m[1] === 1 ? "Bajando {n} fichero" : "Bajando {n} ficheros", { n: m[1] });
  if ((m = s.match(/^Subiendo (\d+)\/(\d+)$/))) return t("Subiendo {i}/{n}", { i: m[1], n: m[2] });
  if ((m = s.match(/^El audio va ([+-]?[\d.]+) s respecto a la letra: ajustándolo$/)))
    return t("El audio va {d} s respecto a la letra: ajustándolo", { d: m[1] });
  if ((m = s.match(/^Whisper (.+)$/))) return t("Whisper {model}", { model: m[1] });
  if ((m = s.match(/^Buscando en (.+)$/))) return t("Buscando en {src}", { src: m[1] });
  if ((m = s.match(/^Notas( precisas)? · (\w+)$/)))
    return t(m[1] ? "Notas precisas · {stem}" : "Notas · {stem}", { stem: t(STEM_INFO[m[2]]?.label ?? m[2]) });
  if ((m = s.match(/^(?:Optimizando MIDI|Optimizar MIDI|Grabando la partitura|Parche del LLM) · (.+)$/))) {
    const [base, n] = m[1].split(/\.opt(?=\d)/); // «piano.opt2» → pista base + versión
    const label = t(STEM_INFO[base]?.label ?? base) + (n ? ` ${t("optimizada")} ${n}` : "");
    return t(`${s.split(" · ")[0]} · {stem}`, { stem: label });
  }
  return s;
}

/** Mensajes de error del motor y de Rust: exactos al diccionario y, si no, estas plantillas (capturas → {param}). */
const ERR_TEMPLATES: [RegExp, string, string[]][] = [
  [/^canción desconocida: (.+)$/, "canción desconocida: {k}", ["k"]],
  [/^MuScriptor necesita permiso: (.+)$/, "MuScriptor necesita permiso: {rest}", ["rest"]],
  [/^el servidor dice (\d+): (.+)$/, "el servidor dice {code}: {msg}", ["code", "msg"]],
  [/^no llego al servidor \((.+?)\): (.+)$/, "no llego al servidor ({url}): {e}", ["url", "e"]],
  [/^ruta rara del servidor: (.+)$/, "ruta rara del servidor: {p}", ["p"]],
  [/^al servidor le falta (.+)$/, "al servidor le falta {r}", ["r"]],
  [/^(.+) ha llegado roto$/, "{r} ha llegado roto", ["r"]],
  [/^acción desconocida: (.+)$/, "acción desconocida: {a}", ["a"]],
  [/^orden desconocida: (.+)$/, "orden desconocida: {c}", ["c"]],
  [/^clave no válida: (.+)$/, "clave no válida: {k}", ["k"]],
  [/^subcomando desconocido: (.+)$/, "subcomando desconocido: {s}", ["s"]],
  [/^ffmpeg no pudo leer (.+?): (.+)$/, "ffmpeg no pudo leer {name}: {e}", ["name", "e"]],
  [/^(\w+) no tiene notas: sácalas desde el mezclador$/, "{stem} no tiene notas: sácalas desde el mezclador", ["stem"]],
  [/^no se pudo lanzar el motor: (.+)$/, "no se pudo lanzar el motor: {e}", ["e"]],
  [/^falta el entorno del motor \((.+?)\): (.+)$/, "falta el entorno del motor ({p}): {r}", ["p", "r"]],
  [/^(\w+) terminó sin respuesta: (.+)$/, "{cmd} terminó sin respuesta: {e}", ["cmd", "e"]],
  [/^el motor se cerró: (.+)$/, "el motor se cerró: {e}", ["e"]],
  [/^(\w+) salió con (.+): (.+)$/, "{cmd} salió con {st}: {e}", ["cmd", "st", "e"]],
  [/^orden no permitida: (.+)$/, "orden no permitida: {c}", ["c"]],
  [/^fuera de las carpetas de datos: (.+)$/, "fuera de las carpetas de datos: {p}", ["p"]],
  [/^ffmpeg no pudo estirar (.+)$/, "ffmpeg no pudo estirar {p}", ["p"]],
  [/^no se importa ese tipo de fichero: \.(.+)$/, "no se importa ese tipo de fichero: .{ext}", ["ext"]],
  [/^velocidad fuera de rango: (.+)$/, "velocidad fuera de rango: {s}", ["s"]],
  [/^falta Claude Code \(claude en el PATH\): (.+)$/, "falta Claude Code (claude en el PATH): {e}", ["e"]],
  [
    /^el audio dura (\d+) s y tu canción (\d+) s: es otra versión\. Usa «Sincronizar con IA»$/,
    "el audio dura {a} s y tu canción {b} s: es otra versión. Usa «Sincronizar con IA»",
    ["a", "b"],
  ],
];

/** Traduce un mensaje de error del motor o de Rust; si no se reconoce, se muestra tal cual (puede venir de yt-dlp, ffmpeg…). */
export function engineErr(s: string): string {
  if (!s) return s;
  const d = DICTS[settings.lang];
  if (d?.[s]) return d[s];
  for (const [re, key, names] of ERR_TEMPLATES) {
    const m = s.match(re);
    if (m) return t(key, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return s;
}
