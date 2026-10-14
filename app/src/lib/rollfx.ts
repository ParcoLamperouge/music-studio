/** El aspecto «de vídeo» del piano roll de Aprender: notas de un solo color con degradado y halo que caen sobre un fondo
 * negro, la línea del teclado encendida, un destello en cada tecla que suena y una estela de polvo brillante que sube
 * desde ella y se desvanece. Personalizable desde el panel «Estilo» (se guarda en los ajustes). */

export type RollStyle = {
  color: string; // #rrggbb: la mano derecha (o la única pista)
  color2: string; // la mano izquierda
  glow: number; // 0-1: halo de las notas, línea del teclado y destellos
  fade: number; // 0-1: cuánto se desvanecen las notas lejos del teclado
  sparkles: "no" | "polvo" | "estrellas" | "corazones";
  round: number; // 0-1: de esquinas casi rectas a píldora
};

export const ROLL_PRESETS: Record<string, RollStyle> = {
  Ámbar: { color: "#f29d38", color2: "#4da3ff", glow: 0.9, fade: 0.35, sparkles: "polvo", round: 0.25 },
  Dorado: { color: "#ffc233", color2: "#5ab4ff", glow: 1, fade: 0.35, sparkles: "polvo", round: 0.2 },
  Nieve: { color: "#f4f8ff", color2: "#7fb2ff", glow: 0.9, fade: 0.4, sparkles: "estrellas", round: 0.6 },
  Magenta: { color: "#e04bd8", color2: "#5b7cff", glow: 1, fade: 0.4, sparkles: "corazones", round: 1 },
  Menta: { color: "#5ef2c2", color2: "#4c8dff", glow: 0.8, fade: 0.3, sparkles: "polvo", round: 0.4 },
  Sobrio: { color: "#f29d38", color2: "#74c6f0", glow: 0.3, fade: 0, sparkles: "no", round: 0.15 },
};
export const ROLL_DEFAULT = ROLL_PRESETS.Ámbar;

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) || 0);
/** `c` mezclado con blanco (`w` 0-1), con transparencia `a`. */
export function tint(c: string, w = 0, a = 1) {
  const [r, g, b] = hex(c).map((v) => Math.round(v + (255 - v) * w));
  return `rgba(${r},${g},${b},${a})`;
}

export function drawBackground(g: CanvasRenderingContext2D, w: number, h: number) {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#000000");
  bg.addColorStop(1, "#07060a");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
}

/** Una nota: degradado de los bordes al centro, casi blanco, y halo; `on` si suena ahora. */
export function drawBar(g: CanvasRenderingContext2D, s: RollStyle, x: number, w: number, top: number, h: number, alpha: number, on: boolean, color = s.color) {
  const inset = Math.min(w * 0.12, 2.5);
  const bx = x + 1 + inset, bw = Math.max(2, w - 2 - inset * 2);
  h = Math.max(h, 4);
  const fill = g.createLinearGradient(bx, 0, bx + bw, 0);
  fill.addColorStop(0, tint(color, 0, 1));
  fill.addColorStop(0.5, tint(color, on ? 0.75 : 0.5, 1));
  fill.addColorStop(1, tint(color, 0, 1));
  g.globalAlpha = alpha;
  g.shadowColor = color;
  g.shadowBlur = (on ? 28 : 12) * s.glow;
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(bx, top, bw, h, Math.max(2, Math.min(bw / 2, h / 2) * s.round));
  g.fill();
  g.globalAlpha = 1;
  g.shadowBlur = 0;
}

type Particle = { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; spin: number; wob: number; color: string };
const KIND = {
  polvo: { rate: 170, burst: 40, size: [0.7, 1.9], vy: [30, 130], life: [1.4, 3.2] },
  estrellas: { rate: 22, burst: 10, size: [1.8, 3.8], vy: [40, 150], life: [0.9, 1.8] },
  corazones: { rate: 12, burst: 6, size: [2.4, 3.8], vy: [35, 100], life: [1.1, 2] },
} as const;
const rnd = ([a, b]: readonly [number, number]) => a + Math.random() * (b - a);

/** Capa de efectos: las notas se pintan en ella (`begin` devuelve su contexto) y `compose` la vuelca sobre el roll con
 * el desvanecido, y añade la línea encendida, los destellos y la estela de chispas de lo que suena. */
export class RollFx {
  readonly layer = document.createElement("canvas");
  readonly g = this.layer.getContext("2d")!;
  private parts: Particle[] = [];
  private prev = new Set<number>();
  private last = 0;
  private acc = new Map<number, number>();

  begin(w: number, h: number, dpr: number) {
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (this.layer.width !== W || this.layer.height !== H) [this.layer.width, this.layer.height] = [W, H];
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, W, H);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return this.g;
  }

  /** `active`: teclas que suenan (x, ancho y color); `lineY`: el borde del teclado; `emit`: si salen chispas (no en pausa). */
  compose(g: CanvasRenderingContext2D, s: RollStyle, w: number, lineY: number, active: Map<number, { x: number; w: number; color: string }>, emit = true) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, this.last ? now - this.last : 0);
    this.last = now;

    // las notas aparecen poco a poco al entrar por arriba
    if (s.fade > 0) {
      const l = this.g;
      l.save();
      l.globalCompositeOperation = "destination-out";
      const m = l.createLinearGradient(0, 0, 0, lineY);
      m.addColorStop(0, `rgba(0,0,0,${s.fade})`);
      m.addColorStop(0.6, "rgba(0,0,0,0)");
      l.fillStyle = m;
      l.fillRect(0, 0, w, lineY);
      l.restore();
    }

    // estela: chispas que salen de lo que suena, suben ondulando y se apagan (detrás de las notas)
    if (s.sparkles !== "no") {
      const k = KIND[s.sparkles];
      for (const [p, key] of emit ? active : []) {
        const n = (this.prev.has(p) ? 0 : k.burst) + this.drip(p, dt * k.rate);
        for (let i = 0; i < n && this.parts.length < 3000; i++)
          this.parts.push({
            x: key.x + key.w / 2 + (Math.random() - 0.5) * key.w * 1.1,
            y: lineY - 3,
            vx: (Math.random() - 0.5) * 24,
            vy: -rnd(k.vy),
            age: 0,
            life: rnd(k.life),
            size: rnd(k.size),
            spin: Math.random() * 6.28,
            wob: 8 + Math.random() * 18,
            color: key.color,
          });
      }
      for (const q of this.parts) {
        q.age += dt;
        q.x += (q.vx + Math.sin(q.age * 3 + q.spin) * q.wob) * dt;
        q.y += q.vy * dt;
        q.vy *= 0.99;
      }
      this.parts = this.parts.filter((q) => q.age < q.life && q.y > 0);
    } else this.parts = [];

    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.layer, 0, 0);
    g.restore();

    // las chispas, delante y sumando luz
    g.save();
    g.globalCompositeOperation = "lighter";
    g.shadowBlur = s.sparkles === "polvo" ? 0 : 8 * s.glow;
    for (const q of this.parts) {
      const a = 1 - q.age / q.life;
      g.globalAlpha = a * a;
      g.shadowColor = q.color;
      g.fillStyle = tint(q.color, 0.35 + Math.sin(q.spin + q.age * 9) * 0.25); // centellea
      shape(g, s.sparkles, q.x, q.y, q.size, q.spin + q.age * 2);
    }
    g.restore();

    // la línea del teclado encendida, y un destello en cada tecla que suena
    if (s.glow > 0) {
      g.save();
      const line = g.createLinearGradient(0, lineY - 14, 0, lineY);
      line.addColorStop(0, tint(s.color, 0, 0));
      line.addColorStop(1, tint(s.color, 0, 0.45 * s.glow));
      g.fillStyle = line;
      g.fillRect(0, lineY - 14, w, 14);
      g.fillStyle = tint(s.color, 0.4, 0.9);
      g.shadowColor = s.color;
      g.shadowBlur = 12 * s.glow;
      g.fillRect(0, lineY - 2, w, 2);
      g.shadowBlur = 0;
      g.globalCompositeOperation = "lighter";
      for (const key of active.values()) {
        // destello aplastado: un círculo con degradado, estirado a lo ancho
        const cx = key.x + key.w / 2, r = Math.max(28, key.w * 3) * s.glow;
        g.save();
        g.translate(cx, lineY);
        g.scale(1.25, 0.5);
        const flare = g.createRadialGradient(0, 0, 0, 0, 0, r);
        flare.addColorStop(0, tint(key.color, 0.85, 0.9));
        flare.addColorStop(0.2, tint(key.color, 0.3, 0.45));
        flare.addColorStop(1, tint(key.color, 0, 0));
        g.fillStyle = flare;
        g.fillRect(-r, -r, 2 * r, 2 * r);
        g.restore();
      }
      g.restore();
    }
    if (emit) this.prev = new Set(active.keys());
  }

  /** Cuántas chispas tocan a la tecla `p` este frame (acumula las fracciones). */
  private drip(p: number, rate: number) {
    const v = (this.acc.get(p) ?? Math.random()) + rate;
    this.acc.set(p, v % 1);
    return Math.floor(v);
  }
}

function shape(g: CanvasRenderingContext2D, kind: RollStyle["sparkles"], x: number, y: number, r: number, rot: number) {
  if (kind === "polvo") return g.fillRect(x - r / 2, y - r / 2, r, r);
  g.beginPath();
  if (kind === "estrellas") {
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4, rr = i % 2 ? r * 0.35 : r * 1.6; // destello de cuatro puntas
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
  } else {
    const s = r * 0.9;
    g.moveTo(x, y + s * 1.2);
    g.bezierCurveTo(x - s * 2, y - s * 0.2, x - s * 0.9, y - s * 1.8, x, y - s * 0.6);
    g.bezierCurveTo(x + s * 0.9, y - s * 1.8, x + s * 2, y - s * 0.2, x, y + s * 1.2);
  }
  g.fill();
}
