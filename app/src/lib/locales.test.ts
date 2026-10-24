import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "./locales/en.ts";
import { zh } from "./locales/zh.ts";

// en y zh deben cubrir las mismas claves (textos españoles) con los mismos {param}.
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("locales: mismas claves y placeholders", () => {
  const ek = Object.keys(en).sort();
  const zk = Object.keys(zh).sort();
  assert.deepEqual(ek, zk, "en y zh tienen que cubrir exactamente las mismas claves");
  for (const k of ek) {
    assert.ok(en[k].trim(), `traducción en vacía: ${k}`);
    assert.ok(zh[k].trim(), `traducción zh vacía: ${k}`);
    assert.equal(params(en[k]), params(k), `placeholder distinto en en: ${k}`);
    assert.equal(params(zh[k]), params(k), `placeholder distinto en zh: ${k}`);
  }
});
