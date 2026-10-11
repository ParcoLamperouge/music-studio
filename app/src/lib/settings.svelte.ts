import { readJson, settingsPath, writeJson } from "./engine";

/** Ajustes generales (settings.json). Rust lee «spotify»; el resto es de la vista. Se guardan juntos y con retardo. */
export const settings = $state({
  masterVolume: 1,
  showMini: false,
  rollSpeed: 2.5,
  scoreFollow: true,
  spotify: true, // sincronizar sola lo que suena en Spotify
  notes: "fast" as "fast" | "precise", // basic-pitch o MuScriptor
  remote: "", // servidor de Estudio (server/server.py): lo procesado, compartido entre ordenadores
  remoteToken: "",
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
