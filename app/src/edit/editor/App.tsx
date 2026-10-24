import { Player, type PlayerRef } from "@remotion/player";
import { openPath } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t, engineErr, engineLabel } from "../../lib/i18n.svelte";
import { Edit } from "../remotion/Edit.tsx";
import { durationOf, FPS, H, W } from "../remotion/timing.ts";
import type { EditProps } from "../remotion/types.ts";
import * as api from "./api.ts";
import type { Job, Preset, Project, Song } from "./api.ts";
import { applyPlan, autoEdit, brief } from "./auto.ts";
import { Lyrics } from "./Lyrics.tsx";
import { Panels } from "./Panels.tsx";
import { Timeline } from "./Timeline.tsx";
import { useHistory } from "./useHistory.ts";

// El tsconfig del editor no carga los tipos de Svelte: declara las runas que usa settings.svelte.ts (llega vía i18n).
declare global {
  function $state<T>(initial: T): T;
  function $state<T>(): T | undefined;
  namespace $state {
    function snapshot<T>(state: T): T;
  }
}

/** Vuelta a la canción en Estudio, pestaña Edits. */
const back = (key?: string) => (location.href = key ? `/?song=${encodeURIComponent(key)}&tab=edits` : "/");

/** Claude's plan for the project's clip, applied over it. */
async function withAI(p: Project, song: Song) {
  const plan = applyPlan(await api.direct(brief(song, p.start, p.end)), p.style, new Set(song.lines.flatMap((l) => l.words.map((w) => w.id))));
  return { project: { ...p, style: plan.style, edits: plan.edits, lineTpl: plan.lineTpl, rate: plan.rate ?? p.rate }, why: plan.why };
}

export function App() {
  const hist = useHistory<Project | null>(null);
  const project = hist.state;
  const [song, setSong] = useState<Song | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState<{ url: string; path: string } | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [ai, setAi] = useState(false);
  const [note, setNote] = useState("");
  const seed = useRef(0);
  const loading = useRef(0); // bumped to cancel a load in flight: its result is then dropped
  const player = useRef<PlayerRef>(null);

  const refresh = useCallback(() => {
    api.listPresets().then(setPresets, () => {});
    api.hasDirector().then(setAi);
  }, []);

  const changePresets = (all: Preset[]) => {
    setPresets(all);
    api.savePresets(all).catch((e) => setError(e.message));
  };

  const run = useCallback(async (start: Promise<Job>) => {
    setError("");
    try {
      return await api.follow(await start, setJob);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJob(null);
    }
  }, []);

  const open = useCallback(
    async (id: string) => {
      setError("");
      const my = ++loading.current;
      const p = await api.loadProject(id);
      if (my !== loading.current) return;
      setSong(null);
      hist.reset(p);
      history.replaceState(null, "", `?project=${id}`);
      const s = await api.loadSong(p.key);
      if (my === loading.current) setSong(s);
    },
    [hist.reset],
  );

  /** One click: song → finished edit. mode = "auto" (local rules), "ai" (Claude directs) or a preset id. */
  const create = useCallback(
    async (key: string, mode = "auto") => {
      setError("");
      setNote("");
      setJob({ id: "", label: "Cargando la canción", progress: 0, status: "running" });
      const my = ++loading.current;
      try {
        const s = await api.loadSong(key);
        if (my !== loading.current) return;
        const preset = presets.find((p) => p.id === mode);
        const a = autoEdit(s, { base: preset?.style });
        let p: Project = {
          id: `${key}-${Date.now().toString(36)}`.slice(-60).replace(/^-/, ""),
          name: s.title,
          key,
          start: a.start,
          end: a.end,
          rate: preset?.rate ?? 1,
          style: a.style,
          edits: a.edits,
          media: [],
          updated: Date.now(),
        };
        if (mode === "ai") {
          setJob({ id: "", label: "La IA está dirigiendo el edit", progress: 0.5, status: "running" });
          try {
            const r = await withAI(p, s);
            p = r.project;
            setNote(r.why);
          } catch (e) {
            setError(t("{e} — queda el edit automático", { e: (e as Error).message }));
          }
        }
        if (my !== loading.current) return;
        await api.saveProject(p);
        hist.reset(p);
        setSong(s);
        history.replaceState(null, "", `?project=${p.id}`);
      } catch (e) {
        if (my === loading.current) setError((e as Error).message);
      } finally {
        if (my === loading.current) setJob(null);
      }
    },
    [hist.reset, presets],
  );

  // ?song=<letras key> (other apps open a song here), ?project=<id> (reload)
  useEffect(() => {
    refresh();
    const q = new URLSearchParams(location.search);
    if (q.get("project")) open(q.get("project")!).catch((e) => setError(e.message));
    else if (q.get("song")) create(q.get("song")!, q.get("mode") ?? "auto");
    else back();
  }, []);

  // autosave
  useEffect(() => {
    if (!project) return;
    const tr = setTimeout(() => api.saveProject({ ...project, updated: Date.now() }).catch((e) => setError(e.message)), 600);
    return () => clearTimeout(tr);
  }, [project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? hist.redo() : hist.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        hist.redo();
      } else if (e.key === " " && !typing) {
        e.preventDefault();
        player.current?.toggle();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [hist.undo, hist.redo]);

  const props: EditProps | null = useMemo(
    () =>
      project && song
        ? {
            lines: song.lines,
            edits: project.edits,
            style: project.style,
            media: project.media.map((m) => ({ ...m, url: api.resolveUrl(m.url) })),
            audio: song.audio,
            start: project.start,
            end: project.end,
            rate: project.rate,
            beats: song.beats,
            env: song.env,
            lineTpl: project.lineTpl,
          }
        : null,
    [project, song],
  );

  const update = hist.set as (fn: (p: Project) => Project, tag?: string) => void;
  const set = useCallback((fn: (p: Project) => Project, tag?: string) => update((p) => fn(p!), tag), [update]);

  if (!project)
    return (
      <div className="home">
        <h1>Edit</h1>
        {error && <div className="error">{engineErr(error)}</div>}
        {job && (
          <div className="job">
            <span>{engineLabel(job.label)}</span>
            <progress value={job.progress} max={1} />
          </div>
        )}
        <p>
          <button className="ghost" onClick={() => back(new URLSearchParams(location.search).get("song") ?? undefined)}>
            ← {t("Volver")}
          </button>
        </p>
      </div>
    );

  const doRender = async () => {
    if (!props) return;
    setRendered(null);
    const j = await run(api.render(props, project.name, project.key));
    if (j) setRendered(j.result);
  };

  return (
    <div className="app">
      <header>
        <button className="ghost" onClick={() => back(project.key)} title={t("Volver a la canción")}>
          ← {song?.title ?? t("Canción")}
        </button>
        <input className="name" value={project.name} onChange={(e) => set((p) => ({ ...p, name: e.target.value }), "name")} />
        <span className="muted">{song ? `${song.artist} — ${song.title}` : t("Cargando…")}</span>
        {note && <span className="note" title={note}>{t("IA")}: {note}</span>}
        <div className="grow" />
        <button
          disabled={!song || !!job}
          title={t("Otra plantilla, colores y destacados para el mismo clip")}
          onClick={() => {
            seed.current++;
            set((p) => ({ ...p, ...autoEdit(song!, { seed: seed.current, range: p }), lineTpl: {} }));
            setNote("");
          }}
        >
          🎲 {t("Otra versión")}
        </button>
        {ai && (
          <button
            disabled={!song || !!job}
            title={t("Claude elige plantilla, colores, palabras destacadas y cortes para este clip")}
            onClick={async () => {
              setError("");
              setJob({ id: "", label: "La IA está dirigiendo el edit", progress: 0.5, status: "running" });
              try {
                const r = await withAI(project, song!);
                set(() => r.project);
                setNote(r.why);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setJob(null);
              }
            }}
          >
            ✨ {t("Dirigir con IA")}
          </button>
        )}
        <button className="ghost" disabled={!hist.canUndo} onClick={hist.undo} title={t("Deshacer (Ctrl+Z)")}>↶</button>
        <button className="ghost" disabled={!hist.canRedo} onClick={hist.redo} title={t("Rehacer (Ctrl+Shift+Z)")}>↷</button>
        {job ? (
          <div className="job">
            <span>{engineLabel(job.label)}</span>
            <progress value={job.progress} max={1} />
          </div>
        ) : rendered ? (
          <button className="done" onClick={() => openPath(rendered.path)} title={rendered.path}>
            {t("Ver MP4")} ↗
          </button>
        ) : null}
        <button className="primary" disabled={!props || !!job} onClick={doRender}>
          {t("Exportar MP4")}
        </button>
      </header>
      {error && <div className="error" onClick={() => setError("")}>{engineErr(error)}</div>}
      <aside className="left">
        <Panels
          project={project}
          song={song}
          set={set}
          busy={!!job}
          presets={presets}
          onPresets={changePresets}
          onSeparate={async () => {
            if (await run(api.separate(project.key))) setSong(await api.loadSong(project.key));
          }}
        />
      </aside>
      <main className="stage">
        {props ? (
          <Player
            ref={player}
            component={Edit}
            inputProps={props}
            durationInFrames={durationOf(props)}
            fps={FPS}
            compositionWidth={W}
            compositionHeight={H}
            controls
            loop
            clickToPlay
            spaceKeyToPlayOrPause={false}
            acknowledgeRemotionLicense
            style={{ height: "100%", aspectRatio: "9 / 16", maxWidth: "100%", borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}
          />
        ) : (
          <div className="muted">{t("Cargando audio…")}</div>
        )}
      </main>
      <aside className="right">{song && <Lyrics project={project} song={song} set={set} player={player} />}</aside>
      <footer>{song && <Timeline project={project} song={song} set={set} player={player} />}</footer>
    </div>
  );
}
