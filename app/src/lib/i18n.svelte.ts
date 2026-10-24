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
  return s;
}
