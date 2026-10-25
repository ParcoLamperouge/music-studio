#!/usr/bin/env python3
"""Optimización de MIDI y partitura de piano legible, en dos piezas separadas.

**Optimizar MIDI** (`quantize_groups`): la transcripción (basic-pitch) arrastra ecos del
audio: notas fantasma, solapes de la misma nota, semitonos simultáneos y ritmos fuera de
rejilla. Aquí se limpian y se cuadran a los pulsos reales de Beat This! (no a un bpm fijo:
el rubato las va desfasando). Sale un roll en segundos `[inicio, fin, nota, fuerza, compás,
mano]`, que la app puede tocar con su piano de muestras y comparar con la pista original.

**Grabar la partitura** (`engrave`): del roll limpio a MusicXML de piano (dos pentagramas)
con compases de verdad, ligaduras, armadura y descomposición rítmica que respeta las anclas
métricas. El PDF lo saca la app (OSMD + jsPDF).

La rejilla vive en `Timeline`: segmentos de compases con su métrica. Hoy beats.json trae un
solo segmento (compás uniforme); si mañana detecta cambios de compás, solo cambia `from_beats`
— cuantización, compases, despiece y grabación ya preguntan compás a compás.

CLI (compatibilidad): engine/.venv/bin/python engine/beautify.py [carpeta_canción] [--stem piano]
"""

import argparse
import json
import re
import statistics
import sys
from bisect import bisect_right
from collections import Counter
from pathlib import Path

DIV = 8          # unidades por negra (semicorchea = 2: admite puntillos de semicorchea)


# ---------------------------------------------------------------- pulsos

def clean_beats(raw):
    """Quita pulsos duplicados (<120 ms) y rellena huecos al tempo local."""
    out = [raw[0]]
    for t in raw[1:]:
        if t - out[-1] >= 0.12:
            out.append(t)
    filled = [out[0]]
    for i in range(1, len(out)):
        gap = out[i] - out[i - 1]
        ctx = out[max(0, i - 4):i] + out[i:i + 4]
        iois = sorted(ctx[j + 1] - ctx[j] for j in range(len(ctx) - 1))
        med = iois[len(iois) // 2] if iois else 0.44
        if gap > 1.5 * med:
            for k in range(1, round(gap / med)):
                filled.append(out[i - 1] + gap * k / round(gap / med))
        filled.append(out[i])
    return filled


def extend_tail(beats, until):
    ioi = statistics.median([beats[i + 1] - beats[i] for i in range(max(0, len(beats) - 9), len(beats) - 1)])
    while beats[-1] < until:
        beats.append(beats[-1] + ioi)
    return beats


def make_to_beat(beats):
    def to_beat(t):
        if t <= beats[0]:
            return (t - beats[0]) / (beats[1] - beats[0])
        if t >= beats[-1]:
            return len(beats) - 1 + (t - beats[-1]) / (beats[-1] - beats[-2])
        lo, hi = 0, len(beats) - 1
        while hi - lo > 1:
            m = (lo + hi) >> 1
            if beats[m] <= t:
                lo = m
            else:
                hi = m
        return lo + (t - beats[lo]) / (beats[hi] - beats[lo])
    return to_beat


def make_from_beat(beats):
    """Pulso (fraccionario) -> segundo, la inversa de to_beat."""
    def from_beat(b):
        if b <= 0:
            return beats[0] + b * (beats[1] - beats[0])
        if b >= len(beats) - 1:
            return beats[-1] + (b - (len(beats) - 1)) * (beats[-1] - beats[-2])
        i = int(b)
        return beats[i] + (b - i) * (beats[i + 1] - beats[i])
    return from_beat


def first_downbeat_index(beats, downbeats, meter):
    idx = []
    for d in downbeats:
        i = min(range(len(beats)), key=lambda j: abs(beats[j] - d))
        if abs(beats[i] - d) < 0.25:
            idx.append(i)
    mod = Counter(i % meter for i in idx).most_common(1)[0][0]
    return next(i for i in idx if i % meter == mod)


def manual_grid(beats, downbeats, meter_old, meter_new, shift=0):
    """Rejilla de downbeats puesta a mano: la fase actual (por votación) movida `shift` pulsos,
    con la métrica nueva. Devuelve (pulso inicial, tiempos de downbeat). Sobre esta rejilla
    reescrita, la votación siguiente devuelve exactamente la misma fase: se puede seguir
    moviendo de uno en uno."""
    start = first_downbeat_index(beats, downbeats or [], meter_old)
    start = max(0, min(start + shift, len(beats) - 1))
    return start, [beats[i] for i in range(start, len(beats), meter_new)]


# ---------------------------------------------------------------- Timeline

class Timeline:
    """La rejilla sobre los pulsos reales, compás a compás: cuánto mide cada compás (en
    unidades DIV), dónde empieza y qué métrica tiene. Hoy un solo segmento de métrica fija
    (beats.json); con cambios de compás, `from_beats` construiría varios y nada más cambia."""

    def __init__(self, beats, start, segments):
        # segments: [(compás inicial, negras por compás, pulso inicial)] en orden
        self.beats, self.start, self.segments = beats, start, segments
        self._to_beat = make_to_beat(beats)
        self._from_beat = make_from_beat(beats)
        self.bar_at, self.bar_len, self.bar_meter = [], [], []
        acc = 0
        for si, (b0, m, beat0) in enumerate(segments):
            end_beat = segments[si + 1][2] if si + 1 < len(segments) else len(beats) - 1
            n = ((end_beat - beat0) // m) if si + 1 < len(segments) else max(1, (end_beat - beat0 + m - 1) // m)
            for k in range(n):
                self.bar_at.append(acc)
                self.bar_len.append(m * DIV)
                self.bar_meter.append(m)
                acc += m * DIV
        self._rhythms = {}

    @classmethod
    def from_beats(cls, beats, downbeats, meter):
        start = first_downbeat_index(beats, downbeats or [], meter)
        return cls(beats, start, [(0, meter, start)])

    def rhythm(self, meter):
        if meter not in self._rhythms:
            self._rhythms[meter] = Rhythm(meter)
        return self._rhythms[meter]

    def bars(self):
        return len(self.bar_len)

    def meter_of_bar(self, bar):
        return self.bar_meter[min(bar, len(self.bar_meter) - 1)]

    def bar_of_unit(self, u):
        i = bisect_right(self.bar_at, max(0, u)) - 1
        return max(0, min(i, len(self.bar_at) - 1))

    def bar_range(self, bar):
        """Unidades [inicio, fin) del compás."""
        i = min(bar, len(self.bar_at) - 1)
        return self.bar_at[i], self.bar_at[i] + self.bar_len[i]

    def to_unit(self, t):
        """Segundo -> unidad global (múltiplo de semicorchea), desde el primer tiempo fuerte."""
        return max(0, round((self._to_beat(t) - self.start) * DIV / 2) * 2)

    def unit_of(self, u):
        """Unidad global -> segundo."""
        return self._from_beat(self.start + u / DIV)


# ---------------------------------------------------------------- notas

def clean_notes(notes):
    """Tira fantasmas (cortos y flojos) y recorta solapes de la misma altura."""
    kept = [n for n in notes if n[1] - n[0] >= 0.075 or n[3] >= 0.45]
    kept.sort(key=lambda n: (n[0], n[2]))
    last = {}
    for n in kept:
        p = last.get(n[2])
        if p is not None and n[0] < p[1] + 0.03:
            p[1] = max(p[0] + 0.07, n[0])
        last[n[2]] = n
    return sorted(kept, key=lambda n: (n[0], n[2]))


def quantize_groups(notes_raw, timeline):
    """Notas crudas (segundos) -> {unidad: [[nota, fin_unidad, fuerza, mano]]}, limpias y cuadradas."""
    clean = clean_notes(notes_raw)
    groups = {}
    for on, off, pitch, vel in clean:
        b = timeline.to_unit(on)
        e = max(b + 2, timeline.to_unit(off))
        groups.setdefault(b, []).append([pitch, e, vel])
    onsets = sorted(groups)
    for b in onsets:                                        # una nota no suena sobre su re-ataque
        for n in groups[b]:
            nxt = [x for x in onsets if x > b and any(m[0] == n[0] for m in groups[x])]
            if nxt:
                n[1] = min(n[1], nxt[0])
    for b in onsets:                                        # semitonos contiguos al mismo golpe
        ns = sorted(groups[b], key=lambda n: n[0])          # (ruido de basic-pitch): queda el más fuerte
        keep = []
        for n in ns:
            if keep and n[0] - keep[-1][0] == 1 and n[2] * (n[1] - b) > keep[-1][2] * (keep[-1][1] - b):
                keep[-1] = n
            elif keep and n[0] - keep[-1][0] == 1:
                continue
            else:
                keep.append(n)
        groups[b] = keep
    S = split_point(clean)
    split_hands(groups, S)
    rebalance_hands(groups, S)
    return groups


def groups_rows(groups, timeline):
    """Grupos cuadrados -> roll en segundos: [inicio, fin, nota, fuerza, compás, mano]."""
    rows = []
    for b, ns in groups.items():
        bar = timeline.bar_of_unit(b)
        for p, e, vel, hand in ns:
            s0 = timeline.unit_of(b)
            s1 = max(s0 + 0.05, timeline.unit_of(e))
            rows.append([round(s0, 3), round(s1, 3), p, round(vel, 2), bar, hand])
    rows.sort(key=lambda n: (n[0], n[2]))
    return rows


def rows_groups(rows, timeline):
    """Roll en segundos -> grupos cuadrados (la inversa; el cuadre ya viene hecho)."""
    groups = {}
    for r in rows:
        b = timeline.to_unit(r[0])
        e = max(b + 2, timeline.to_unit(r[1]))
        groups.setdefault(b, []).append([r[2], e, r[3], r[5] if len(r) > 5 else "rh"])
    return groups


def refresh_bars(rows, timeline):
    """Roll con el compás (y la mano) al día en cada fila: el guardado caduca si el compás se
    corrigió a mano, y los tramos copiados de un stem vienen sin esas columnas."""
    return [[r[0], r[1], r[2], r[3], timeline.bar_of_unit(timeline.to_unit(r[0])), r[5] if len(r) > 5 else "rh"] for r in rows]


# ---------------------------------------------------------------- manos

def split_point(notes):
    """Umbral de mano: el valle del histograma de alturas (ponderado por duración) entre
    Do3 y Si3 — en un solo de piano melodía y acompañamiento viven a los lados."""
    h = {}
    for n in notes:
        h[n[2]] = h.get(n[2], 0) + max(n[1] - n[0], 0.1)
    best, best_mass = 54, float("inf")
    for s in range(50, 61):
        mass = h.get(s, 0) + h.get(s + 1, 0)
        if mass < best_mass:
            best, best_mass = s, mass
    return best


def split_hands(groups, S):
    """p >= S va a la derecha; los acordes muy abiertos se parten por el hueco cercano a S."""
    for on in sorted(groups):
        ns = groups[on]
        pitches = sorted(n[0] for n in ns)
        cut = None
        if len(pitches) > 1 and pitches[-1] - pitches[0] >= 10:
            gaps = [(b - a, (a + b) / 2) for a, b in zip(pitches, pitches[1:])]
            near = [(g, c) for g, c in gaps if g >= 5 and S - 5 <= c <= S + 6]
            if near:
                cut = min(near, key=lambda gc: abs(gc[1] - S))[1]
        for n in ns:
            if cut is not None:
                n.append("rh" if n[0] > cut else "lh")
            else:
                n.append("rh" if n[0] >= S else "lh")


def rebalance_hands(groups, S):
    """Notas lejos de la línea de su mano (mediana local, ±8 golpes) cambian de mano."""
    for _ in range(2):
        seqs = {"rh": [], "lh": []}
        for b in sorted(groups):
            for n in groups[b]:
                seqs[n[-1]].append((b, n))
        for hand, other in (("rh", "lh"), ("lh", "rh")):
            seq = sorted(seqs[hand])
            pitches = [n[0] for _, n in seq]
            for i, (b, n) in enumerate(seq):
                local = statistics.median(pitches[max(0, i - 8):i + 8])
                if hand == "rh" and n[0] < S - 2 and n[0] < local - 5:
                    n[-1] = other
                elif hand == "lh" and n[0] > S + 7 and n[0] > local + 5:
                    n[-1] = other


# ---------------------------------------------------------------- tonalidad

MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


def ks_key(weights):
    tot = sum(weights) or 1
    w = [x / tot for x in weights]
    ma = statistics.mean(w)
    best = (-2, (0, False))
    for tonic in range(12):
        for prof, minor in ((MAJOR, False), (MINOR, True)):
            pm = statistics.mean(prof)
            p = [prof[(i - tonic) % 12] for i in range(12)]
            num = sum((x - ma) * (y - pm) for x, y in zip(w, p))
            den = (sum((x - ma) ** 2 for x in w) * sum((y - pm) ** 2 for y in p)) ** 0.5
            r = num / den if den else 0
            if r > best[0]:
                best = (r, (tonic, minor))
    tonic, minor = best[1]
    fifths = ((tonic + (0 if not minor else 3)) * 7) % 12
    return tonic, minor, (fifths if fifths <= 6 else fifths - 12)


# ---------------------------------------------------------------- ritmo

class Rhythm:
    """Valores rítmicos (en unidades DIV) y sus anclas métricas, para un compás de `meter`
    negras. Todos los valores son pares: el despiece siempre cuadra y no deja restos impares.
    Los silencios puntillosos solo sobre el pulso (menos torres de silencios raras)."""

    def __init__(self, meter):
        if meter not in (2, 3, 4):
            raise ValueError(f"compás {meter}/4 sin despiece escrito (solo 2/4, 3/4 y 4/4)")
        self.meter = meter
        self.bar = meter * DIV
        vals = {24: ("half", 1), 16: ("half", 0), 12: ("quarter", 1), 8: ("quarter", 0),
                6: ("eighth", 1), 4: ("eighth", 0), 2: ("16th", 0)}
        if meter >= 4:
            vals[32] = ("whole", 0)     # 32 unidades: el compás entero
        if meter < 3:
            del vals[24]                # puntillo de blanca no cabe en 2/4
        self.vals = vals

    def fits(self, pos, v):
        pos %= self.bar
        if v == 32:
            return pos == 0
        if v == 24:
            return pos == 0
        if v == 16:
            return pos % 8 == 0 and pos + 16 <= self.bar
        if v in (12, 8):
            return pos % 8 == 0
        return pos % 2 == 0

    def fits_rest(self, pos, v):
        pos %= self.bar
        if v in (32, 24):
            return pos == 0
        if v in (16, 12):
            return pos % 8 == 0
        if v == 6:
            return pos % 4 == 0
        return self.fits(pos, v)

    def split(self, pos, dur, rest=False):
        parts = []
        while dur > 0:
            for v in sorted(self.vals, reverse=True):
                if v <= dur and (self.fits_rest(pos, v) if rest else self.fits(pos, v)):
                    parts.append(v)
                    pos, dur = pos + v, dur - v
                    break
            else:
                parts.append(2)
                pos, dur = pos + 2, dur - 2
        return parts

    def type_of(self, v):
        return self.vals.get(v) or ("16th", 0)


# ---------------------------------------------------------------- grabación

STEP = {0: ("C", 0), 1: ("C", 1), 2: ("D", 0), 3: ("D", 1), 4: ("E", 0), 5: ("F", 0), 6: ("F", 1),
        7: ("G", 0), 8: ("G", 1), 9: ("A", 0), 10: ("A", 1), 11: ("B", 0)}
SHARP_ORDER = "FCGDAEB"
FLAT_ORDER = "BEADGCF"
ACC = {1: "sharp", -1: "flat", 0: "natural", 2: "double-sharp", -2: "flat-flat"}


def key_alter(step, fifths):
    if fifths > 0 and step in SHARP_ORDER[:fifths]:
        return 1
    if fifths < 0 and step in FLAT_ORDER[:-fifths]:
        return -1
    return 0


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def engrave(groups, timeline, title, artist=""):
    """Grupos cuadrados -> (MusicXML de piano, meta). La armadura es global; los compases,
    su métrica, salen del Timeline (cambios de compás = <time> por compás)."""
    names = "C C# D D# E F F# G G# A A# B".split()

    def segments(hand):
        segs = []
        for b in sorted(groups):
            ns = [n for n in groups[b] if n[-1] == hand]
            if ns:
                segs.append([b, max(n[1] for n in ns), {n[0] for n in ns}])
        return segs

    segs = {h: segments(h) for h in ("rh", "lh")}
    n_measures = max((timeline.bar_of_unit(s[1] - 1) for ss in segs.values() for s in ss), default=0) + 1

    # tonalidad global (reservado: cambios por tramo cuando haya detección fiable)
    bars_pc = [Counter() for _ in range(n_measures)]
    for b, ns in groups.items():
        c = bars_pc[timeline.bar_of_unit(b)]
        for n in ns:
            c[n[0] % 12] += max(n[1] - b, 2)
    total = Counter()
    for c in bars_pc:
        total.update(c)
    tonic, minor, fifths = ks_key([total.get(i, 0.0) for i in range(12)])

    bpm = round(60 / statistics.median([timeline.beats[i + 1] - timeline.beats[i] for i in range(len(timeline.beats) - 1)]))
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
           '"http://www.musicxml.org/dtds/partwise.dtd">',
           '<score-partwise version="4.0">',
           f'<work><work-title>{esc(title)}</work-title></work>',
           f'<identification><creator type="composer">{esc(artist)}</creator>'
           '<encoding><software>beautify.py</software></encoding></identification>',
           '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>',
           '<part id="P1">']

    for m in range(n_measures):
        m0, m1 = timeline.bar_range(m)
        meter = timeline.meter_of_bar(m)
        rh = timeline.rhythm(meter)
        xml.append(f'<measure number="{m + 1}">')
        attrs = []
        if m == 0:
            attrs.append(f'<divisions>{DIV}</divisions>'
                         f'<key><fifths>{fifths}</fifths><mode>{"minor" if minor else "major"}</mode></key>')
        if m == 0 or meter != timeline.meter_of_bar(m - 1):
            attrs.append(f'<time><beats>{meter}</beats><beat-type>4</beat-type></time><staves>2</staves>'
                         '<clef number="1"><sign>G</sign><line>2</line></clef>'
                         '<clef number="2"><sign>F</sign><line>4</line></clef>')
        if attrs:
            xml.append("<attributes>" + "".join(attrs) + "</attributes>")
        if m == 0:
            xml.append(f'<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                       f'<per-minute>{bpm}</per-minute></metronome></direction-type>'
                       f'<sound tempo="{bpm}"/></direction>')

        for staff, (hand, voice) in enumerate((("rh", 1), ("lh", 5)), 1):
            if staff == 2:
                xml.append(f'<backup><duration>{m1 - m0}</duration></backup>')
            evs = []
            for b, e, ps in segs[hand]:
                if b < m1 and e > m0:
                    evs.append([max(b, m0), min(e, m1), sorted(ps), b >= m0])
            evs.sort(key=lambda x: x[0])

            units = []
            pos = m0
            for i, (b, e, ps, is_start) in enumerate(evs):
                if b > pos:
                    for v in rh.split(pos - m0, b - pos, rest=True):
                        units.append({"pos": pos, "v": v, "rest": True})
                        pos += v
                nxt = evs[i + 1][0] if i + 1 < len(evs) else m1
                pieces = rh.split(b - m0, min(e, nxt) - b)
                at = b
                for j, v in enumerate(pieces):
                    units.append({"pos": at, "v": v, "rest": False, "ps": ps,
                                  "tie_l": (j > 0) or not is_start,
                                  "tie_r": j < len(pieces) - 1})
                    at += v
                pos = b + sum(pieces)
            while pos < m1:
                for v in rh.split(pos - m0, m1 - pos, rest=True):
                    units.append({"pos": pos, "v": v, "rest": True})
                    pos += v
                break

            run = []
            for u in units + [{"rest": True, "v": 0, "pos": 10 ** 9}]:
                if not u["rest"] and u["v"] in (4, 2) and u["pos"] // 8 == (run[0]["pos"] // 8 if run else u["pos"] // 8):
                    run.append(u)
                    continue
                if len(run) >= 2:
                    for k, r in enumerate(run):
                        r["beam1"] = "begin" if k == 0 else "end" if k == len(run) - 1 else "continue"
                    if all(r["v"] == 2 for r in run):
                        for k, r in enumerate(run):
                            r["beam2"] = "begin" if k == 0 else "end" if k == len(run) - 1 else "continue"
                    else:
                        for k, r in enumerate(run):
                            if r["v"] != 2:
                                continue
                            prev2 = k > 0 and run[k - 1]["v"] == 2 and run[k - 1]["pos"] + 2 == r["pos"]
                            next2 = k < len(run) - 1 and run[k + 1]["v"] == 2 and r["pos"] + 2 == run[k + 1]["pos"]
                            if prev2 and next2:
                                r["beam2"] = "continue"
                            elif next2:
                                r["beam2"] = "begin"
                            elif prev2:
                                r["beam2"] = "end"
                run = [] if u["rest"] or u["v"] not in (4, 2) else [u]

            acc = {}
            for u in units:
                v = u["v"]
                if u["rest"]:
                    xml.append(f'<note><rest/><duration>{v}</duration><voice>{voice}</voice>'
                               f'<type>{rh.type_of(v)[0]}</type>{"<dot/>" * rh.type_of(v)[1]}<staff>{staff}</staff></note>')
                    continue
                for k, p in enumerate(u["ps"]):
                    step, alter = STEP[p % 12]
                    octv = p // 12 - 1
                    ka = key_alter(step, fifths)
                    shown = acc.get((step, octv))
                    need = alter != ka and shown != alter
                    acc[(step, octv)] = alter
                    beams = ""
                    if k == 0:
                        for bn, keyname in ((1, "beam1"), (2, "beam2")):
                            if keyname in u:
                                beams += f'<beam number="{bn}">{u[keyname]}</beam>'
                    ties = ('<tie type="stop"/>' if u["tie_l"] else "") + ('<tie type="start"/>' if u["tie_r"] else "")
                    nots = ""
                    if u["tie_l"] or u["tie_r"]:
                        nots = ('<notations>' + ('<tied type="stop"/>' if u["tie_l"] else "")
                                + ('<tied type="start"/>' if u["tie_r"] else "") + '</notations>')
                    xml.append(f'<note>{"<chord/>" if k else ""}'
                               f'<pitch><step>{step}</step>{"<alter>%d</alter>" % alter if alter else ""}'
                               f'<octave>{octv}</octave></pitch><duration>{v}</duration>{ties}'
                               f'<voice>{voice}</voice><type>{rh.type_of(v)[0]}</type>{"<dot/>" * rh.type_of(v)[1]}'
                               f'{"<accidental>%s</accidental>" % ACC[alter] if need else ""}'
                               f'<staff>{staff}</staff>{beams}{nots}</note>')
        xml.append('</measure>')
    xml.append('</part></score-partwise>')

    bmeta = {"startBeat": timeline.start, "startSec": round(timeline.beats[timeline.start], 3),
             "meter": timeline.segments[0][1], "key": {"tonic": names[tonic], "minor": minor, "fifths": fifths},
             "bpm": bpm, "measures": n_measures, "title": title}
    return "\n".join(xml), bmeta


def process(song_dir, stem):
    """Compatibilidad con la primera versión: limpia + graba una pista entera de golpe."""
    meta = json.loads((song_dir / "meta.json").read_text())
    beats_info = json.loads((song_dir / "beats.json").read_text())
    info = next(s for s in meta["stems"] if s["name"] == stem)
    notes = json.loads((song_dir / info["roll"]).read_text())
    beats = extend_tail(clean_beats(beats_info["beats"]), max(n[1] for n in notes) + 1)
    tl = Timeline.from_beats(beats, beats_info.get("downbeats", []), beats_info.get("meter") or 4)
    rows = groups_rows(quantize_groups(notes, tl), tl)
    title = meta["title"].split(" — ")[-1]
    artist = re.sub(r"^\d{4}\.\d{2}\.\d{2}\s*", "", meta.get("artist", ""))
    xml, bmeta = engrave(rows_groups(rows, tl), tl, title, artist)
    scores = song_dir / "scores"
    scores.mkdir(exist_ok=True)
    (scores / f"{stem}.beauty.musicxml").write_text(xml, encoding="utf-8")
    (scores / f"{stem}.beauty.notes.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
    (scores / f"{stem}.beauty.meta.json").write_text(json.dumps(bmeta, ensure_ascii=False, indent=1))
    n_rh = sum(1 for r in rows if r[5] == "rh")
    stats = (f"notas {len(notes)} → {len(rows)} · {bmeta['measures']} compases de {bmeta['meter']}/4 · "
             f"{bmeta['key']['tonic']} {'menor' if bmeta['key']['minor'] else 'mayor'} · bpm≈{bmeta['bpm']} · manos {n_rh}/{len(rows) - n_rh}")
    print(stats, file=sys.stderr)
    return {"musicxml": str(scores / f"{stem}.beauty.musicxml"), "roll": str(scores / f"{stem}.beauty.notes.json"),
            "meta": bmeta, "stats": stats}


if __name__ == "__main__":
    home = Path.home() / ".local/share/stemlab/songs"
    default = sorted(home.glob("*老人與海*"))[0] if list(home.glob("*老人與海*")) else None
    ap = argparse.ArgumentParser()
    ap.add_argument("song", nargs="?", default=str(default) if default else None)
    ap.add_argument("--stem", default="piano")
    a = ap.parse_args()
    res = process(Path(a.song).expanduser(), a.stem)
    print(res["musicxml"])
