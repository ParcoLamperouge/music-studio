import type { IconName } from "../ui/Icon.svelte";

/** Las vistas de la barra de iconos, en orden (Alt+1…7). «cantar» no está: se entra desde una canción. */
export type View = "biblioteca" | "aprender" | "curso" | "oido" | "tocar" | "sesiones" | "progresiones" | "cantar";
export const RAIL: { id: View; label: string; icon: IconName }[] = [
  { id: "biblioteca", label: "Biblioteca", icon: "library" },
  { id: "aprender", label: "Aprender", icon: "learn" },
  { id: "curso", label: "Curso", icon: "course" },
  { id: "oido", label: "Oído", icon: "ear" },
  { id: "tocar", label: "Tocar", icon: "midi" },
  { id: "sesiones", label: "Sesiones", icon: "sessions" },
  { id: "progresiones", label: "Progresiones", icon: "progressions" },
];
const OLD: Record<string, View> = { analizar: "biblioteca" };
/** «?mode=…» de la URL (también los nombres viejos) → vista. */
export const viewOf = (mode: string | null): View => (mode && (OLD[mode] ?? (RAIL.some((r) => r.id === mode) || mode === "cantar" ? (mode as View) : null))) || "biblioteca";

/** Texto sin acentos ni mayúsculas, para buscar. */
export const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
