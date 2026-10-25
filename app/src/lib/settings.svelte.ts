import { readJson, settingsPath, writeJson } from "./engine";
import { ROLL_DEFAULT } from "./rollfx";

/** Ajustes generales (settings.json). Rust lee «spotify»; el resto es de la vista. Se guardan juntos y con retardo. */
export const settings = $state({
  // idioma de la interfaz; sin valor guardado, el del sistema (zh→zh, es→es, resto→en)
  lang: ((n = (navigator?.language ?? "en").toLowerCase()) =>
    n.startsWith("zh") ? "zh" : n.startsWith("es") ? "es" : "en")() as "es" | "en" | "zh",
  masterVolume: 1,
  showMini: false,
  rollSpeed: 2.5,
  rollHeight: null as number | null, // altura del piano roll arrastrada por el usuario; null: automática (el resto del sitio)
  rollBars: true, // rayas de compás (con número) en el piano roll
  rollChords: true, // raya naranja en cada cambio de acorde, con su nombre a la derecha
  rollStyle: { ...ROLL_DEFAULT }, // aspecto del piano roll de Aprender (rollfx.ts)
  scoreFollow: true,
  spotify: true, // sincronizar sola lo que suena en Spotify
  notes: "fast" as "fast" | "precise", // basic-pitch o MuScriptor
  latencyMs: 0, // retraso teclado→oído que se resta al juzgar el tiempo (Aprender)
  remote: "", // servidor de Estudio (server/server.py): lo procesado, compartido entre ordenadores
  remoteToken: "",
  ai: { url: "", model: "", key: "" }, // LLM con API compatible con OpenAI (DeepSeek, Kimi, GLM, Ollama…): reseñas
});

let loaded = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export async function loadSettings() {
  Object.assign(settings, await readJson(settingsPath(), $state.snapshot(settings)));
  loaded = true;
}

/** Llamar tras cambiar algo: agrupa los movimientos de un deslizador. */
export function saveSettings() {
  if (!loaded) return;
  clearTimeout(timer);
  timer = setTimeout(() => void writeJson(settingsPath(), $state.snapshot(settings)), 400);
}
