import { getCurrentWindow } from "@tauri-apps/api/window";

/** Pone la ventana nativa a pantalla completa (además del overlay CSS del componente). */
export const setWindowFullscreen = (on: boolean) => void getCurrentWindow().setFullscreen(on).catch(() => {});
