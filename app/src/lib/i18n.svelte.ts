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
