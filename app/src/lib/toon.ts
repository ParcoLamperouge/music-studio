/** TOON (Token-Oriented Object Notation): lo mismo que JSON con bastantes menos tokens, para lo que solo lee la IA.
 * Objetos con sangría, listas de valores en una línea y listas de objetos iguales como tabla: `notas[3]{t,nota}:` y una
 * fila por elemento. https://github.com/toon-format/spec — solo lo que hace falta aquí (sin decodificar). */

type Value = unknown;

const prim = (x: Value) => x === null || ["string", "number", "boolean"].includes(typeof x);
const isObj = (x: Value): x is Record<string, Value> => !!x && typeof x === "object" && !Array.isArray(x);

/** Comillas solo si hacen falta: vacío, espacios al borde, separadores, o algo que se leería como número, booleano o null. */
const needsQuote = (s: string) =>
  s === "" || s !== s.trim() || /[,:"\\[\]{}\n\r\t]/.test(s) || s.startsWith("-") || /^(true|false|null)$/.test(s) || /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s);

function str(x: Value): string {
  if (typeof x === "string") return needsQuote(x) ? JSON.stringify(x) : x;
  if (typeof x === "number") return Number.isFinite(x) ? String(Object.is(x, -0) ? 0 : x) : "null";
  return String(x);
}
const key = (k: string) => (/^[A-Za-z_][\w.]*$/.test(k) ? k : JSON.stringify(k));
const pad = (d: number) => "  ".repeat(d);

function fields(o: Record<string, Value>, d: number): string[] {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .flatMap(([k, v]) => (prim(v) ? [`${pad(d)}${key(k)}: ${str(v)}`] : Array.isArray(v) ? list(key(k), v, d) : [`${pad(d)}${key(k)}:`, ...fields(v as Record<string, Value>, d + 1)]));
}

function list(name: string, a: Value[], d: number): string[] {
  if (a.every(prim)) return [`${pad(d)}${name}[${a.length}]:${a.length ? ` ${a.map(str).join(",")}` : ""}`];
  const cols = isObj(a[0]) ? Object.keys(a[0]) : [];
  const table = cols.length && a.every((x) => isObj(x) && Object.keys(x).length === cols.length && cols.every((c) => c in x && prim(x[c])));
  if (table) return [`${pad(d)}${name}[${a.length}]{${cols.map(key).join(",")}}:`, ...a.map((x) => pad(d + 1) + cols.map((c) => str((x as Record<string, Value>)[c])).join(","))];
  return [`${pad(d)}${name}[${a.length}]:`, ...a.flatMap((x) => item(x, d + 1))];
}

function item(x: Value, d: number): string[] {
  if (prim(x)) return [`${pad(d)}- ${str(x)}`];
  if (Array.isArray(x)) {
    const [head, ...rest] = list("", x, d);
    return [`${pad(d)}- ${head.trimStart()}`, ...rest];
  }
  const [first, ...rest] = fields(x as Record<string, Value>, d + 1); // el primer campo va en la línea del guion
  return first ? [`${pad(d)}- ${first.trimStart()}`, ...rest] : [`${pad(d)}-`];
}

export function toToon(v: Value): string {
  if (isObj(v)) return fields(v, 0).join("\n");
  if (Array.isArray(v)) return list("", v, 0).join("\n");
  return str(v);
}
