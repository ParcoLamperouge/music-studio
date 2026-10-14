/** Entrada de notas para Tocar y Aprender: el teclado MIDI (por Rust: WebKitGTK no tiene Web MIDI) y el del ordenador
 * como piano para probar. Una vista a la vez la usa (useInput) y recibe cada mensaje MIDI tal cual. */

import { Channel, invoke } from "@tauri-apps/api/core";

type Handler = (msg: number[]) => void;

export const input = $state({ ports: [] as string[], port: "", connected: "", hasOut: false, error: "", octave: 60 });

let handler: Handler = () => {};
let failed = ""; // no reintentar solo uno que no abre
const store = (k: string, v?: string) => {
  try {
    return v == null ? localStorage.getItem(k) : (localStorage.setItem(k, v), v);
  } catch {
    return null;
  }
};

async function scan() {
  try {
    input.ports = await invoke<string[]>("midi_ports");
  } catch (e) {
    input.error = String(e);
    return;
  }
  if (input.connected && !input.ports.includes(input.connected)) {
    input.connected = "";
    input.error = "Se desconectó el teclado";
    void invoke("midi_close");
  }
  // al enchufarlo (o al abrir): el último usado, o el único que hay
  if (!input.connected) {
    const last = store("estudio.midi");
    const pick = input.ports.find((p) => p === last) ?? (input.ports.length === 1 ? input.ports[0] : "");
    if (pick && pick !== failed) void connect(pick);
    else if (!input.port) input.port = input.ports[0] ?? "";
  }
}

export async function connect(name: string) {
  input.port = name;
  input.error = "";
  const ch = new Channel<number[]>();
  ch.onmessage = (msg) => handler(msg);
  try {
    input.hasOut = await invoke<boolean>("midi_open", { name, on: ch });
    input.connected = name;
    failed = "";
    store("estudio.midi", name);
  } catch (e) {
    input.connected = "";
    failed = name;
    input.error = String(e);
  }
}

/** Al teclado MIDI (si tiene salida): volumen, o las notas del teclado del ordenador para que suenen en él. */
export const send = (msg: number[]) => (input.hasOut ? invoke("midi_send", { msg }) : Promise.resolve());

/** La vista que escucha ahora; busca el teclado al montar y cada 2 s (enchufar y desenchufar el USB en marcha). */
export function useInput(h: Handler) {
  handler = h;
  void scan();
  const poll = setInterval(scan, 2000);
  return () => {
    clearInterval(poll);
    if (handler !== h) return; // otra vista ya la tomó (se montó antes de que esta se desmontara)
    pcRelease();
    handler = () => {};
    void invoke("midi_close");
    input.connected = "";
  };
}

// ---------------------------------------------------------------- el teclado del ordenador como piano (para probar)
// por posición (e.code), no por letra: igual en QWERTY español o inglés. Fila A-Ñ blancas, la de arriba negras.
const PC_KEYS: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};
const pressed = new Map<string, number>(); // tecla → nota, por si cambia la octava con ella abajo
let pedal = false;

/** Como si llegara del teclado MIDI; si hay piano conectado, además suena en él. */
function pcNote(msg: number[]) {
  handler(msg);
  void send(msg).catch(() => {});
}

/** onkeydown y onkeyup de la ventana. `channel`: el del teclado MIDI, para que todo vaya junto. */
export function pcKey(e: KeyboardEvent, channel = 0) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const down = e.type === "keydown";
  if (e.code in PC_KEYS) {
    e.preventDefault();
    if (down && !e.repeat && !pressed.has(e.code)) {
      const p = input.octave + PC_KEYS[e.code];
      pressed.set(e.code, p);
      pcNote([0x90 | channel, p, 90]);
    } else if (!down && pressed.has(e.code)) {
      pcNote([0x80 | channel, pressed.get(e.code)!, 0]);
      pressed.delete(e.code);
    }
  } else if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat && pedal !== down) pcNote([0xb0 | channel, 64, (pedal = down) ? 127 : 0]);
  } else if (down && (e.code === "KeyZ" || e.code === "KeyX")) {
    e.preventDefault();
    input.octave = Math.min(96, Math.max(24, input.octave + (e.code === "KeyX" ? 12 : -12)));
  }
}

/** Al perder el foco no llega el keyup: se suelta todo para que no se quede sonando. */
export function pcRelease(channel = 0) {
  for (const p of pressed.values()) pcNote([0x80 | channel, p, 0]);
  pressed.clear();
  if (pedal) pcNote([0xb0 | channel, 64, 0]);
  pedal = false;
}
