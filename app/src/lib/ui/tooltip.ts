/** Tooltip: `use:tooltip={"Texto"}` o `use:tooltip={{ text, kbd, side }}`. Uno solo, flotando en <body> (no lo corta
 * ningún overflow); sale al pasar el ratón o al enfocar con el teclado, tras una pausa corta. */
export type TipOpts = { text: string; kbd?: string; side?: "right" | "top" | "bottom" | "left" };

let el: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function show(target: HTMLElement, o: TipOpts) {
  if (!el) {
    el = document.createElement("div");
    el.setAttribute("role", "tooltip");
    Object.assign(el.style, {
      position: "fixed", zIndex: "200", pointerEvents: "none", padding: "4px 8px", borderRadius: "var(--r-md)",
      background: "var(--panel-hi)", color: "var(--text)", border: "1px solid var(--line-hi)", boxShadow: "var(--shadow)",
      font: "500 var(--fs-sm)/1.4 var(--mono)", whiteSpace: "nowrap", display: "flex", gap: "8px", alignItems: "center",
      animation: "fade var(--t-fast)",
    });
    document.body.append(el);
  }
  el.replaceChildren(o.text);
  if (o.kbd) {
    const k = document.createElement("kbd");
    k.textContent = o.kbd;
    el.append(k);
  }
  el.style.display = "flex";
  const r = target.getBoundingClientRect(), t = el.getBoundingClientRect(), gap = 8;
  const side = o.side ?? "top";
  let x = side === "right" ? r.right + gap : side === "left" ? r.left - gap - t.width : r.left + r.width / 2 - t.width / 2;
  let y = side === "top" ? r.top - gap - t.height : side === "bottom" ? r.bottom + gap : r.top + r.height / 2 - t.height / 2;
  x = Math.max(4, Math.min(x, innerWidth - t.width - 4));
  y = Math.max(4, Math.min(y, innerHeight - t.height - 4));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function hide() {
  clearTimeout(timer);
  if (el) el.style.display = "none";
}

export function tooltip(node: HTMLElement, opts: TipOpts | string | undefined) {
  let o = typeof opts === "string" ? { text: opts } : opts;
  const enter = () => {
    clearTimeout(timer);
    if (o?.text) timer = setTimeout(() => node.isConnected && show(node, o!), 350);
  };
  const events = ["mouseenter", "focus"] as const, out = ["mouseleave", "blur", "pointerdown"] as const;
  events.forEach((e) => node.addEventListener(e, enter));
  out.forEach((e) => node.addEventListener(e, hide));
  return {
    update(next: TipOpts | string | undefined) {
      o = typeof next === "string" ? { text: next } : next;
    },
    destroy() {
      events.forEach((e) => node.removeEventListener(e, enter));
      out.forEach((e) => node.removeEventListener(e, hide));
      hide();
    },
  };
}
