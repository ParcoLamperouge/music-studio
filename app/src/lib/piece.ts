/** Piezas: canciones para tocar escritas a mano (el editor) o importadas (MIDI, MusicXML). Notas en negras, con su mano
 * y tempo fijo; se guardan en piezas/<id>.json y se practican en Aprender como las canciones separadas. */

import type { ANote, Arrangement, Hand } from "./arrange.ts";
import type { Key, Note } from "./harmony.ts";

export type PNote = ANote & { hand: Hand };
export type Piece = { id: string; title: string; bpm: number; meter: number; key?: Key; notes: PNote[]; modified?: number };

export const newPiece = (title = "Sin título"): Piece => ({ id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title, bpm: 90, meter: 4, notes: [] });
/** La mano por defecto de una nota: la izquierda por debajo del Do central. */
export const handOf = (p: number): Hand => (p < 60 ? "lh" : "rh");
export const pieceLength = (pc: Piece) => pc.notes.reduce((m, n) => Math.max(m, n.b + n.d), 0);

/** Notas de una mano en segundos ([inicio, fin, nota, velocidad]). */
export const pieceSeconds = (pc: Piece, hand?: Hand): Note[] =>
  pc.notes.filter((n) => !hand || n.hand === hand).map((n) => [(n.b * 60) / pc.bpm, ((n.b + n.d) * 60) / pc.bpm, n.p, n.v]);
/** Pulsos de la pieza en segundos (tempo fijo), hasta un poco después del final. */
export const pieceBeats = (pc: Piece) => Array.from({ length: Math.ceil(pieceLength(pc)) + 9 }, (_, i) => (i * 60) / pc.bpm);

/** La pieza tal cual como arreglo (el nivel 5 de una pieza), con transporte. */
export function pieceArrangement(pc: Piece, key: Key, transpose = 0): Arrangement {
  const of = (h: Hand) => pc.notes.filter((n) => n.hand === h).map(({ hand: _, ...n }) => ({ ...n, p: n.p + transpose }));
  return { rh: of("rh"), lh: of("lh"), key: { tonic: (key.tonic + transpose + 12) % 12, minor: key.minor }, transpose, meter: pc.meter, start: 0 };
}

/** Eventos MIDI de la pieza (para el .mid y para pasarla a sesión), en segundos. */
export function pieceEvents(pc: Piece): [number, number[]][] {
  const ev: [number, number[]][] = [];
  for (const n of pc.notes) {
    const v = Math.max(1, Math.min(127, Math.round(n.v * 127)));
    ev.push([(n.b * 60) / pc.bpm, [0x90, n.p, v]], [((n.b + n.d) * 60) / pc.bpm, [0x80, n.p, 0]]);
  }
  // a igual instante, primero los que sueltan (una nota repetida no se come a la siguiente)
  return ev.sort((a, b) => a[0] - b[0] || (a[1][0] === 0x80 ? -1 : 1) - (b[1][0] === 0x80 ? -1 : 1));
}

/** Una sesión del teclado (notas en segundos, sin tempo) como pieza: a 120 bpm (una negra cada medio segundo), sin
 * cuadrar; cada nota a su mano por el Do central. */
export function fromSession(notes: Note[], title: string): Piece {
  return { ...newPiece(title), bpm: 120, notes: notes.map(([s, e, p, v]) => ({ b: s * 2, d: Math.max(0.05, (e - s) * 2), p, v, hand: handOf(p) })) };
}

// ---------------------------------------------------------------- MIDI

/** Un .mid estándar (tipo 0 o 1) como pieza: negras = pulsos del fichero, el primer tempo y compás que traiga. Con dos
 * pistas o más con notas, la de notas más agudas de media es la derecha; con una, se reparte en el Do central. */
export function fromMidi(bytes: Uint8Array, title = "MIDI"): Piece {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
  if (str(0) !== "MThd") throw new Error("No es un MIDI");
  const ntrks = dv.getUint16(10);
  const division = dv.getUint16(12);
  if (division & 0x8000) throw new Error("MIDI con tiempo SMPTE: no se puede leer");
  let pos = 8 + dv.getUint32(4);
  let bpm = 0, meter = 0, name = "";
  const tracks: { b: number; d: number; p: number; v: number }[][] = [];
  for (let t = 0; t < ntrks && pos + 8 <= bytes.length; t++) {
    if (str(pos) !== "MTrk") break;
    const end = pos + 8 + dv.getUint32(pos + 4);
    let i = pos + 8, tick = 0, status = 0;
    const open = new Map<number, { tick: number; v: number }>();
    const notes: { b: number; d: number; p: number; v: number }[] = [];
    const vlq = () => {
      let n = 0, x;
      do n = (n << 7) | ((x = bytes[i++]) & 0x7f);
      while (x & 0x80);
      return n;
    };
    const close = (k: number) => {
      const o = open.get(k);
      if (!o) return;
      open.delete(k);
      if (tick > o.tick) notes.push({ b: o.tick / division, d: (tick - o.tick) / division, p: k & 0x7f, v: o.v });
    };
    while (i < end) {
      tick += vlq();
      let st = bytes[i];
      if (st & 0x80) i++;
      else st = status; // running status
      if (st === 0xff) {
        const type = bytes[i++], len = vlq();
        if (type === 0x51 && !bpm) bpm = 60e6 / ((bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]);
        if (type === 0x58 && !meter) meter = Math.round((bytes[i] * 4) / 2 ** bytes[i + 1]);
        if (type === 0x03 && !name && t === 0) name = new TextDecoder().decode(bytes.slice(i, i + len)).trim();
        i += len;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) {
        i += vlq();
        continue;
      }
      status = st;
      const kind = st & 0xf0, ch = st & 0x0f;
      const a = bytes[i++], b = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[i++];
      const k = (ch << 7) | a;
      if (kind === 0x90 && b > 0) {
        close(k);
        open.set(k, { tick, v: b / 127 });
      } else if (kind === 0x80 || kind === 0x90) close(k);
    }
    for (const k of [...open.keys()]) close(k);
    if (notes.length) tracks.push(notes);
    pos = end;
  }
  const avg = (ns: { p: number }[]) => ns.reduce((s, n) => s + n.p, 0) / ns.length;
  const ranked = [...tracks].sort((x, y) => avg(y) - avg(x));
  const notes: PNote[] =
    ranked.length >= 2
      ? ranked.flatMap((ns, i) => ns.map((n) => ({ ...n, hand: i === 0 ? ("rh" as Hand) : avg(ns) >= 60 && i < ranked.length - 1 ? ("rh" as Hand) : ("lh" as Hand) })))
      : (ranked[0] ?? []).map((n) => ({ ...n, hand: handOf(n.p) }));
  return { ...newPiece(name || title), bpm: Math.round(bpm || 120), meter: meter >= 2 && meter <= 12 ? meter : 4, notes: notes.sort((x, y) => x.b - y.b) };
}

// ---------------------------------------------------------------- MusicXML

type El = { tag: string; attrs: Record<string, string>; kids: El[]; text: string };

/** XML a árbol, lo justo para MusicXML (sin DOMParser: así también va en los tests de node). */
export function parseXml(src: string): El {
  const root: El = { tag: "#root", attrs: {}, kids: [], text: "" };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const ent = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (_, e: string) =>
    ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[e.toLowerCase() as "lt"] ?? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)));
  for (const m of src.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[6] != null) top.text += ent(m[6]);
    else if (m[3]) {
      if (m[2]) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = ent(a[2] ?? a[3]);
      const el: El = { tag: m[3], attrs, kids: [], text: "" };
      top.kids.push(el);
      if (!m[5]) stack.push(el);
    }
  }
  return root;
}
const kid = (e: El | undefined, tag: string) => e?.kids.find((k) => k.tag === tag);
const kids = (e: El | undefined, tag: string) => e?.kids.filter((k) => k.tag === tag) ?? [];
const txt = (e: El | undefined, tag: string) => kid(e, tag)?.text.trim() ?? "";
const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MusicXML (score-partwise) como pieza. Dos pentagramas en una parte: el de arriba es la derecha; varias partes: la
 * primera la derecha y las demás la izquierda; uno solo: se reparte en el Do central. Las ligaduras unen notas, las
 * notas de adorno no cuentan. */
export function fromMusicXML(xml: string, title = "MusicXML"): Piece {
  const doc = parseXml(xml);
  const score = kid(doc, "score-partwise");
  if (!score) throw new Error(kid(doc, "score-timewise") ? "MusicXML «timewise»: no se puede leer" : "No es un MusicXML");
  const name = txt(kid(score, "work"), "work-title") || txt(score, "movement-title") || title;
  const parts = kids(score, "part");
  const notes: PNote[] = [];
  let bpm = 0, meter = 0;
  let key: Key | undefined;
  parts.forEach((part, pi) => {
    let div = 1, pos = 0, lastStart = 0, staves = 1;
    const tied = new Map<string, PNote>(); // nota que sigue ligada, por altura y pentagrama
    const partNotes: (PNote & { staff: number })[] = [];
    for (const m of kids(part, "measure")) {
      for (const el of m.kids) {
        if (el.tag === "attributes") {
          if (kid(el, "divisions")) div = +txt(el, "divisions") || 1;
          if (kid(el, "staves")) staves = +txt(el, "staves") || 1;
          const time = kid(el, "time");
          if (time && !meter) meter = Math.round((+txt(time, "beats") * 4) / (+txt(time, "beat-type") || 4)) || 4;
          const k = kid(el, "key");
          if (k && !key && kid(k, "fifths")) {
            const f = +txt(k, "fifths"), minor = txt(k, "mode") === "minor";
            const major = ((f * 7) % 12 + 12) % 12;
            key = { tonic: minor ? (major + 9) % 12 : major, minor };
          }
        } else if (el.tag === "direction" || el.tag === "sound") {
          const snd = el.tag === "sound" ? el : kid(el, "sound");
          const tempo = snd?.attrs.tempo ?? kid(kid(kid(el, "direction-type"), "metronome"), "per-minute")?.text;
          if (tempo && !bpm) bpm = +tempo || 0;
        } else if (el.tag === "backup") pos -= +txt(el, "duration") / div;
        else if (el.tag === "forward") pos += +txt(el, "duration") / div;
        else if (el.tag === "note") {
          if (kid(el, "grace")) continue;
          const d = +txt(el, "duration") / div || 0;
          const start = kid(el, "chord") ? lastStart : pos;
          if (!kid(el, "chord")) {
            lastStart = pos;
            pos += d;
          }
          const pitch = kid(el, "pitch");
          if (!pitch || kid(el, "rest")) continue;
          const p = 12 * (+txt(pitch, "octave") + 1) + STEP[txt(pitch, "step")] + (+txt(pitch, "alter") || 0);
          const staff = +txt(el, "staff") || 1;
          const ties = kids(el, "tie").map((t) => t.attrs.type);
          const id = `${p}/${staff}`;
          const prev = tied.get(id);
          if (prev && ties.includes("stop")) {
            prev.d = start + d - prev.b; // sigue la misma nota
            if (!ties.includes("start")) tied.delete(id);
            continue;
          }
          const hand: Hand = parts.length > 1 ? (pi === 0 ? "rh" : "lh") : staves > 1 ? (staff === 1 ? "rh" : "lh") : handOf(p);
          const n = { b: start, d, p, v: 0.7, hand, staff };
          partNotes.push(n);
          if (ties.includes("start")) tied.set(id, n);
        }
      }
    }
    for (const { staff: _, ...n } of partNotes) notes.push(n);
  });
  return { ...newPiece(name), bpm: Math.round(bpm || 90), meter: meter || 4, key, notes: notes.filter((n) => n.d > 0).sort((x, y) => x.b - y.b || x.p - y.p) };
}

/** .mxl: un zip con el MusicXML dentro (META-INF/container.xml dice cuál). Sin librerías: el directorio del zip a mano y
 * DecompressionStream para lo comprimido. */
export async function unzipMxl(bytes: Uint8Array): Promise<string> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) (eocd = i), (i = -1);
  if (eocd < 0) throw new Error("No es un .mxl (zip)");
  const files = new Map<string, () => Promise<Uint8Array>>();
  let p = dv.getUint32(eocd + 16, true);
  for (let n = dv.getUint16(eocd + 10, true); n > 0; n--) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen));
    files.set(name, async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = bytes.slice(start, start + size);
      if (method === 0) return data;
      if (method !== 8) throw new Error(`.mxl comprimido con un método raro (${method})`);
      return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    });
    p += 46 + nameLen + extra + comment;
  }
  const dec = async (name: string) => new TextDecoder().decode(await files.get(name)!());
  const container = files.has("META-INF/container.xml") ? parseXml(await dec("META-INF/container.xml")) : null;
  const root = kid(kid(kid(container ?? undefined, "container"), "rootfiles"), "rootfile")?.attrs["full-path"];
  const name = root ?? [...files.keys()].find((f) => /\.(musicxml|xml)$/i.test(f) && !f.startsWith("META-INF"));
  if (!name || !files.has(name)) throw new Error("El .mxl no trae partitura");
  return dec(name);
}

/** Lo que sea que se importe, según su extensión. */
export async function importPiece(name: string, bytes: Uint8Array): Promise<Piece> {
  const title = name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  if (/\.midi?$/i.test(name)) return fromMidi(bytes, title);
  if (/\.mxl$/i.test(name)) return fromMusicXML(await unzipMxl(bytes), title);
  if (/\.(musicxml|xml)$/i.test(name)) return fromMusicXML(new TextDecoder().decode(bytes), title);
  throw new Error("Formato no reconocido: MIDI (.mid) o MusicXML (.musicxml, .xml, .mxl)");
}
