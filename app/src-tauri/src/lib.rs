//! Estudio: cola de trabajos y servidor de ficheros. La IA es de Letras y StemLab (engine/hub.py los une);
//! aquí se decide cuándo corre cada paso:
//! - GPU: uno a la vez, en un único proceso (`hub.py worker`) que deja el modelo cargado entre canciones.
//!   Entre los pasos listos gana el que usa el mismo modelo que el anterior: en una tanda, todas las
//!   separaciones seguidas, luego todo Whisper… sin recargar pesos.
//! - CPU (notas, pulsos, alineado), red (búsquedas, descargas) y render: en paralelo, con su propio límite.
//! - Trabajos con dependencias (la letra espera a la separación si viene detrás: así usa la voz buena),
//!   cancelables (se mata el grupo de procesos), con prioridad y guardados en disco: sobreviven a cerrar la app.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, LazyLock, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

mod midi;

// ---------------------------------------------------------------- rutas

fn engine_dir() -> PathBuf {
    std::env::var("ESTUDIO_ENGINE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../engine")))
}

fn app_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/.."))
}

/// El venv del motor (engine/.venv, `uv sync`).
fn python() -> PathBuf {
    std::env::var("ESTUDIO_PYTHON").map(PathBuf::from).unwrap_or_else(|_| engine_dir().join(".venv/bin/python"))
}

#[derive(Clone, Serialize)]
struct Paths {
    letras: String,
    stemlab: String,
    data: String,
    edits: String,
    port: u16,
    token: String,
}

static PATHS: OnceLock<Paths> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();

fn paths() -> &'static Paths {
    PATHS.get().expect("rutas sin iniciar")
}

fn roots() -> Vec<PathBuf> {
    let p = paths();
    [&p.letras, &p.stemlab, &p.data, &p.edits]
        .iter()
        .map(|d| {
            let _ = std::fs::create_dir_all(d);
            std::fs::canonicalize(d).unwrap_or_else(|_| PathBuf::from(d))
        })
        .collect()
}

/// Ruta real dentro de alguna carpeta de datos, o error (nada de ../ ni enlaces que salgan fuera).
fn inside(path: &Path) -> Result<PathBuf, String> {
    let real = std::fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if roots().iter().any(|r| real.starts_with(r)) {
        Ok(real)
    } else {
        Err(format!("fuera de las carpetas de datos: {}", path.display()))
    }
}

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn hub(args: &[String]) -> Command {
    let mut c = Command::new(python());
    c.arg(engine_dir().join("hub.py")).args(args).env("PYTHONUNBUFFERED", "1");
    c
}

fn kill_group(pid: u32) {
    // cada paso va en su propio grupo: así muere también lo que lance (ffmpeg, yt-dlp…)
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

/// Orden corta (catálogo, ficha, plan…): devuelve su `done`.
fn hub_once(args: &[String]) -> Result<Value, String> {
    let py = python();
    if !py.exists() {
        return Err(format!("falta el entorno del motor ({}): cd {} && uv sync", py.display(), engine_dir().display()));
    }
    let out = hub(args).stdin(Stdio::null()).output().map_err(|e| format!("no se pudo lanzar el motor: {e}"))?;
    let mut done = None;
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let Ok(ev) = serde_json::from_str::<Value>(line) else { continue };
        match ev["event"].as_str() {
            Some("done") => done = Some(ev),
            Some("error") => return Err(ev["message"].as_str().unwrap_or("error").to_string()),
            _ => {}
        }
    }
    done.ok_or_else(|| {
        let err = String::from_utf8_lossy(&out.stderr);
        format!("{} terminó sin respuesta: {}", args.first().map(String::as_str).unwrap_or(""), err.lines().last().unwrap_or(""))
    })
}

// ---------------------------------------------------------------- cola

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
enum Res {
    Gpu,
    Cpu,
    Net,
    Render,
}

/// Cuántos pasos de cada tipo a la vez. GPU siempre 1 (8-12 GB no dan para dos modelos).
fn limit(r: Res) -> usize {
    let cores = thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    match r {
        Res::Gpu => 1,
        Res::Cpu => std::env::var("ESTUDIO_CPU_JOBS").ok().and_then(|v| v.parse().ok()).unwrap_or((cores / 4).max(2)),
        Res::Net => 4,
        Res::Render => 1,
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct Step {
    cmd: String,
    #[serde(default)]
    args: Vec<String>,
    res: Res,
    label: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    node: bool, // script de Node (render) en vez de hub.py
    #[serde(default)]
    status: String, // "" | running | done | skipped | error
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct Dep {
    id: String,
    hard: bool, // si falla, este trabajo no tiene sentido (notas sin pistas); si no, sigue igual
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct Job {
    id: String,
    action: String,
    key: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    status: String, // queued | planning | ready | running | done | error | canceled
    #[serde(default)]
    steps: Vec<Step>,
    #[serde(default)]
    cur: usize,
    #[serde(default)]
    after: Vec<Dep>,
    #[serde(default)]
    then: Vec<Vec<String>>, // acciones que encolar con la clave del resultado (importar -> letra, pistas…)
    #[serde(default)]
    label: String,
    #[serde(default)]
    pct: Option<f64>,
    #[serde(default)]
    waiting: String,
    #[serde(default)]
    error: String,
    #[serde(default)]
    result: Value,
    #[serde(default)]
    created: f64,
    #[serde(default)]
    started: f64,
    #[serde(default)]
    finished: f64,
    #[serde(default)]
    prio: f64,
    /// fase actual del paso (inicio y ancho, 0..1): la barra de tqdm de cada fase se escala dentro
    #[serde(skip)]
    span: (f64, f64),
}

impl Job {
    fn finished(&self) -> bool {
        matches!(self.status.as_str(), "done" | "error" | "canceled")
    }
    fn next(&self) -> Option<&Step> {
        (self.status == "ready").then(|| self.steps.get(self.cur)).flatten()
    }
}

struct Worker {
    child: Child,
    stdin: ChildStdin,
    rx: mpsc::Receiver<Value>,
}

#[derive(Default)]
struct Queue {
    jobs: Vec<Job>,
    running: HashMap<String, (Res, Option<u32>)>, // job -> recurso y pid del grupo (el del worker en GPU)
    worker: Option<Worker>,
    last_model: Option<String>,
    gpu_gen: u64,
    flushing: bool,
    seq: u64,
}

static Q: LazyLock<Mutex<Queue>> = LazyLock::new(Default::default);
static DIRTY: AtomicBool = AtomicBool::new(false);
static CHANGED: LazyLock<Mutex<Vec<String>>> = LazyLock::new(Default::default);

fn touch() {
    DIRTY.store(true, Ordering::Relaxed);
}

fn changed(key: &str) {
    CHANGED.lock().unwrap().push(key.to_string());
    touch();
}

fn queue_file() -> PathBuf {
    PathBuf::from(&paths().data).join("queue.json")
}

/// Lo pendiente a disco: al abrir la app sigue donde lo dejó (lo que estaba a medias empieza de nuevo;
/// cada paso mira lo que ya hay, así que no se repite trabajo hecho).
fn persist(q: &Queue) {
    let pending: Vec<Value> = q
        .jobs
        .iter()
        .filter(|j| !j.finished())
        .map(|j| json!({"id": j.id, "action": j.action, "key": j.key, "args": j.args, "title": j.title, "after": j.after, "then": j.then, "created": j.created, "prio": j.prio, "steps": if matches!(j.action.as_str(), "import" | "render") { json!(j.steps) } else { json!([]) }}))
        .collect();
    let f = queue_file();
    let tmp = f.with_extension("tmp");
    if std::fs::write(&tmp, serde_json::to_vec(&pending).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(tmp, f);
    }
}

fn restore_queue() {
    let Ok(text) = std::fs::read_to_string(queue_file()) else { return };
    let Ok(jobs) = serde_json::from_str::<Vec<Job>>(&text) else { return };
    let mut q = Q.lock().unwrap();
    for mut j in jobs {
        j.status = "queued".into();
        j.cur = 0;
        for s in &mut j.steps {
            s.status.clear();
        }
        q.seq += 1;
        q.jobs.push(j);
    }
}

fn snapshot(q: &Queue) -> Value {
    // terminados: los 150 últimos
    let mut done: Vec<&Job> = q.jobs.iter().filter(|j| j.finished()).collect();
    done.sort_by(|a, b| b.finished.total_cmp(&a.finished));
    let keep: Vec<&String> = done.iter().skip(150).map(|j| &j.id).collect();
    json!(q.jobs.iter().filter(|j| !keep.contains(&&j.id)).collect::<Vec<_>>())
}

fn with_job(id: &str, f: impl FnOnce(&mut Job)) {
    if let Some(j) = Q.lock().unwrap().jobs.iter_mut().find(|j| j.id == id) {
        f(j);
        touch();
    }
}

/// Trabajo con dependencias automáticas: lo que lea la voz o las pistas espera a la separación de esa
/// canción que haya en cola (la voz de StemLab es mejor, y así no se separa dos veces).
fn push(q: &mut Queue, action: &str, key: &str, args: Vec<String>, mut after: Vec<Dep>, then: Vec<Vec<String>>) -> String {
    if let Some(j) = q.jobs.iter().find(|j| !j.finished() && j.action == action && j.key == key && j.args == args) {
        return j.id.clone();
    }
    let sep = q.jobs.iter().find(|j| !j.finished() && j.action == "separate" && j.key == key).map(|j| j.id.clone());
    if let Some(sep) = sep {
        let hard = action == "notes";
        if matches!(action, "letra" | "sync" | "notes") && !after.iter().any(|d| d.id == sep) {
            after.push(Dep { id: sep, hard });
        }
    }
    q.seq += 1;
    let id = format!("j{}-{}", now() as u64, q.seq);
    q.jobs.push(Job {
        id: id.clone(),
        action: action.into(),
        key: key.into(),
        args,
        title: String::new(),
        status: "queued".into(),
        steps: vec![],
        cur: 0,
        after,
        then,
        label: String::new(),
        pct: None,
        waiting: String::new(),
        error: String::new(),
        result: Value::Null,
        created: now() + q.seq as f64 * 1e-6,
        started: 0.0,
        finished: 0.0,
        prio: 0.0,
        span: (0.0, 1.0),
    });
    id
}

fn has_lyrics(key: &str) -> bool {
    PathBuf::from(&paths().letras).join("lyrics").join(format!("{key}.json")).exists()
}

/// «Todo»: pistas, letra y notas de cada instrumento, en el orden que menos GPU gasta. La búsqueda de la letra
/// (red) corre mientras se separa; la letra se sincroniza con la voz de la separación; las notas de los
/// instrumentos (CPU) mientras la GPU hace Whisper; las de la voz, con la letra ya hecha.
fn push_all(q: &mut Queue, key: &str, quality: &str) -> Vec<String> {
    let sep = push(q, "separate", key, vec![], vec![], vec![]);
    // acordes del audio (GPU, ~15 s): no dependen de nada
    let mut ids = vec![sep.clone(), push(q, "chords", key, vec![], vec![], vec![])];
    let letras = !key.starts_with("stem:");
    let mut sync = None;
    if letras {
        let mut after = vec![Dep { id: sep.clone(), hard: false }];
        if !has_lyrics(key) {
            let f = push(q, "find", key, vec![], vec![], vec![]);
            ids.push(f.clone());
            after.push(Dep { id: f, hard: false });
        }
        let s = push(q, "sync", key, vec![], after, vec![]);
        ids.push(s.clone());
        sync = Some(s);
    }
    for stem in ["bass", "guitar", "piano", "other", "vocals"] {
        let mut after = vec![Dep { id: sep.clone(), hard: true }];
        if stem == "vocals" {
            if let Some(s) = &sync {
                after.push(Dep { id: s.clone(), hard: false });
            }
        }
        ids.push(push(q, "notes", key, notes_args(stem, quality), after, vec![]));
    }
    ids
}

/// Notas rápidas (basic-pitch) o precisas (MuScriptor): ["bass"] o ["bass", "precise"].
fn notes_args(stem: &str, quality: &str) -> Vec<String> {
    let mut a = vec![stem.to_string()];
    if quality == "precise" {
        a.push("precise".into());
    }
    a
}

fn enqueue_locked(q: &mut Queue, action: &str, keys: &[String], args: &[String], then: &[Vec<String>]) -> Vec<String> {
    let mut ids = vec![];
    for key in keys {
        match action {
            "todo" => ids.extend(push_all(q, key, args.first().map(String::as_str).unwrap_or(""))),
            "notes-all" => {
                for stem in ["bass", "guitar", "piano", "other", "vocals"] {
                    ids.push(push(q, "notes", key, notes_args(stem, args.first().map(String::as_str).unwrap_or("")), vec![], vec![]));
                }
            }
            _ => ids.push(push(q, action, key, args.to_vec(), vec![], then.to_vec())),
        }
    }
    ids
}

fn finish(q: &mut Queue, id: &str, status: &str, error: String) {
    let Some(j) = q.jobs.iter_mut().find(|j| j.id == id) else { return };
    if j.finished() {
        return;
    }
    j.status = status.into();
    j.error = error;
    j.finished = now();
    j.waiting.clear();
    let key = j.key.clone();
    let failed = status != "done";
    let then: Vec<Vec<String>> = if failed { vec![] } else { j.then.clone() };
    let new_key = j.result["key"].as_str().unwrap_or(&key).to_string();
    // lo que dependía de este: si era imprescindible, tampoco se hace
    if failed {
        let deps: Vec<String> = q
            .jobs
            .iter()
            .filter(|d| !d.finished() && d.after.iter().any(|a| a.id == id && a.hard))
            .map(|d| d.id.clone())
            .collect();
        for d in deps {
            finish(q, &d, if status == "canceled" { "canceled" } else { "error" }, format!("no se pudo: {}", if status == "canceled" { "se canceló lo anterior" } else { "falló lo anterior" }));
        }
    }
    for t in then {
        if let Some((action, args)) = t.split_first() {
            enqueue_locked(q, action, &[new_key.clone()], args, &[]);
        }
    }
    changed(&key);
}

/// Arranca todo lo que pueda arrancar. Se llama tras cualquier cambio.
fn tick() {
    let mut q = Q.lock().unwrap();
    let q_ref = &mut *q;
    // 1. dependencias resueltas -> planificar
    let ids: Vec<String> = q_ref.jobs.iter().filter(|j| j.status == "queued").map(|j| j.id.clone()).collect();
    for id in ids {
        let j = q_ref.jobs.iter().find(|j| j.id == id).unwrap();
        let deps: Vec<(Option<String>, bool)> =
            j.after.iter().map(|d| (q_ref.jobs.iter().find(|x| x.id == d.id).map(|x| x.status.clone()), d.hard)).collect();
        if deps.iter().any(|(s, _)| s.as_deref().is_some_and(|s| !matches!(s, "done" | "error" | "canceled"))) {
            continue; // aún esperando
        }
        if deps.iter().any(|(s, hard)| *hard && s.as_deref().is_some_and(|s| s != "done")) {
            finish(q_ref, &id, "error", "no se pudo: falló lo anterior".into());
            continue;
        }
        let j = q_ref.jobs.iter_mut().find(|j| j.id == id).unwrap();
        if !j.steps.is_empty() {
            j.status = "ready".into(); // importar y exportar traen sus pasos
            continue;
        }
        j.status = "planning".into();
        let (action, key, args) = (j.action.clone(), j.key.clone(), j.args.clone());
        thread::spawn(move || plan(id, action, key, args));
    }
    // 2. pasos listos, por prioridad y orden de llegada
    let mut busy: HashMap<Res, usize> = HashMap::new();
    for (r, _) in q_ref.running.values() {
        *busy.entry(*r).or_default() += 1;
    }
    if q_ref.flushing {
        *busy.entry(Res::Gpu).or_default() += 1;
    }
    let mut order: Vec<usize> = (0..q_ref.jobs.len()).filter(|&i| q_ref.jobs[i].next().is_some()).collect();
    order.sort_by(|&a, &b| {
        let (a, b) = (&q_ref.jobs[a], &q_ref.jobs[b]);
        a.prio.total_cmp(&b.prio).then(a.created.total_cmp(&b.created))
    });
    // GPU: el que use el modelo que ya está cargado, si no el primero
    let gpu: Vec<usize> = order.iter().copied().filter(|&i| q_ref.jobs[i].next().unwrap().res == Res::Gpu).collect();
    let pick = gpu
        .iter()
        .copied()
        .find(|&i| q_ref.jobs[i].next().unwrap().model.is_some() && q_ref.jobs[i].next().unwrap().model == q_ref.last_model)
        .or(gpu.first().copied());
    let mut start = vec![];
    for i in order {
        let res = q_ref.jobs[i].next().unwrap().res;
        if res == Res::Gpu && Some(i) != pick {
            continue;
        }
        let n = busy.entry(res).or_default();
        if *n < limit(res) {
            *n += 1;
            start.push(i);
        }
    }
    for i in start {
        let j = &mut q_ref.jobs[i];
        let step = j.steps[j.cur].clone();
        j.status = "running".into();
        j.steps[j.cur].status = "running".into();
        j.label = step.label.clone();
        j.pct = None;
        j.span = (0.0, 1.0);
        j.waiting.clear();
        if j.started == 0.0 {
            j.started = now();
        }
        let id = j.id.clone();
        q_ref.running.insert(id.clone(), (step.res, None));
        if step.res == Res::Gpu {
            q_ref.gpu_gen += 1;
            q_ref.last_model = step.model.clone();
        }
        thread::spawn(move || run_step(id, step));
    }
    // 3. GPU parada y nada más para ella: soltar VRAM y candado en un rato (por si llega otro paso)
    let gpu_idle = !q_ref.running.values().any(|(r, _)| *r == Res::Gpu) && !q_ref.flushing;
    let gpu_soon = q_ref.jobs.iter().any(|j| !j.finished() && j.steps.iter().skip(j.cur).any(|s| s.res == Res::Gpu));
    if gpu_idle && !gpu_soon && q_ref.worker.is_some() {
        let gen = q_ref.gpu_gen;
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(15));
            flush(gen);
        });
    }
    persist(q_ref);
    touch();
}

fn flush(gen: u64) {
    let mut w = {
        let mut q = Q.lock().unwrap();
        if q.gpu_gen != gen || q.flushing || q.running.values().any(|(r, _)| *r == Res::Gpu) {
            return;
        }
        let Some(w) = q.worker.take() else { return };
        q.flushing = true;
        w
    };
    let ok = writeln!(w.stdin, "{}", json!({"cmd": "flush"})).is_ok()
        && loop {
            match w.rx.recv_timeout(Duration::from_secs(30)) {
                Ok(ev) if ev["event"] == "end" => break true,
                Ok(ev) if ev["event"] == "exit" => break false,
                Ok(_) => {}
                Err(_) => break false,
            }
        };
    let mut q = Q.lock().unwrap();
    q.flushing = false;
    q.last_model = None;
    if ok {
        q.worker = Some(w);
    } else {
        kill_group(w.child.id());
        let _ = w.child.wait();
    }
    drop(q);
    tick();
}

fn plan(id: String, action: String, key: String, args: Vec<String>) {
    let mut a = vec!["plan".to_string(), action, key];
    a.extend(args);
    let r = hub_once(&a);
    {
        let mut q = Q.lock().unwrap();
        let Some(j) = q.jobs.iter_mut().find(|j| j.id == id) else { return };
        if j.status != "planning" {
            return; // cancelado mientras planificaba
        }
        match r {
            Ok(done) => {
                j.title = done["title"].as_str().unwrap_or(&j.key).to_string();
                j.steps = serde_json::from_value(done["steps"].clone()).unwrap_or_default();
                if j.steps.is_empty() {
                    j.label = "Ya estaba hecho".into();
                    finish(&mut q, &id, "done", String::new());
                } else {
                    j.status = "ready".into();
                }
            }
            Err(e) => finish(&mut q, &id, "error", e),
        }
    }
    tick();
}

#[derive(Default)]
struct Out {
    result: Option<Value>,
    error: Option<String>,
    tail: Vec<String>,
}

fn on_event(id: &str, ev: &Value, out: &mut Out) {
    match ev["event"].as_str() {
        Some("done") => out.result = Some(ev.clone()),
        Some("error") => out.error = Some(ev["message"].as_str().unwrap_or("error").to_string()),
        Some("log") => {
            out.tail.push(ev["line"].as_str().unwrap_or("").to_string());
            if out.tail.len() > 12 {
                out.tail.remove(0);
            }
        }
        Some("progress") => {
            let label = ev["label"].as_str().unwrap_or("").to_string();
            let (s, t) = (ev["step"].as_f64().unwrap_or(1.0), ev["total"].as_f64().unwrap_or(1.0));
            with_job(id, |j| {
                j.label = label;
                j.waiting.clear();
                j.span = (((s - 1.0) / t).max(0.0), 1.0 / t.max(1.0));
                j.pct = (t > 1.0).then(|| j.span.0 * 100.0);
            });
        }
        Some("pct") => {
            let v = ev["value"].as_f64().unwrap_or(0.0);
            with_job(id, |j| {
                j.waiting.clear();
                let (a, w) = if j.span.1 > 0.0 { j.span } else { (0.0, 1.0) };
                j.pct = Some((a + w * v / 100.0) * 100.0);
            });
        }
        Some("waiting") => {
            let label = ev["label"].as_str().unwrap_or("").to_string();
            with_job(id, |j| j.waiting = label);
        }
        _ => {}
    }
}

/// stderr: barras tqdm -> `pct`, el resto -> `log` (las últimas líneas acompañan al error).
fn read_stderr(stderr: impl Read + Send + 'static, tx: mpsc::Sender<Value>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut last = u32::MAX;
        for chunk in BufReader::new(stderr).split(b'\r') {
            let Ok(chunk) = chunk else { break };
            for part in String::from_utf8_lossy(&chunk).split('\n') {
                match tqdm_pct(part) {
                    Some(n) if n != last => {
                        last = n;
                        let _ = tx.send(json!({"event": "pct", "value": n}));
                    }
                    Some(_) => {}
                    None if !part.trim().is_empty() => {
                        let _ = tx.send(json!({"event": "log", "line": part}));
                    }
                    None => {}
                }
            }
        }
    })
}

/// " 41%|████      | 11/27 [00:27<...]" -> Some(41)
fn tqdm_pct(line: &str) -> Option<u32> {
    let (head, _) = line.split_once("%|")?;
    head.rsplit(' ').next()?.parse().ok()
}

fn spawn_worker() -> Result<Worker, String> {
    let mut child = hub(&["worker".into()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("no se pudo lanzar el motor: {e}"))?;
    let (tx, rx) = mpsc::channel();
    let stdout = child.stdout.take().unwrap();
    let t = tx.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Ok(ev) = serde_json::from_str::<Value>(&line) {
                let _ = t.send(ev);
            }
        }
        let _ = t.send(json!({"event": "exit"}));
    });
    read_stderr(child.stderr.take().unwrap(), tx);
    let stdin = child.stdin.take().unwrap();
    Ok(Worker { child, stdin, rx })
}

fn run_gpu(id: &str, step: &Step) -> Out {
    let mut out = Out::default();
    let req = json!({"cmd": step.cmd, "args": step.args}).to_string();
    // el que quedó en reposo pudo morir (sin memoria, matado a mano): entonces uno nuevo
    let taken = Q.lock().unwrap().worker.take().and_then(|mut w| w.child.try_wait().ok().flatten().is_none().then_some(w));
    let mut w = match taken.map(Ok).unwrap_or_else(spawn_worker) {
        Ok(w) => w,
        Err(e) => return Out { error: Some(e), ..Default::default() },
    };
    if writeln!(w.stdin, "{req}").is_err() {
        kill_group(w.child.id());
        let _ = w.child.wait();
        w = match spawn_worker() {
            Ok(w) => w,
            Err(e) => return Out { error: Some(e), ..Default::default() },
        };
        let _ = writeln!(w.stdin, "{req}");
    }
    if let Some(r) = Q.lock().unwrap().running.get_mut(id) {
        r.1 = Some(w.child.id());
    }
    let mut alive = true;
    while alive {
        match w.rx.recv() {
            Ok(ev) if ev["event"] == "end" => break,
            Ok(ev) if ev["event"] == "exit" => alive = false,
            Ok(ev) => on_event(id, &ev, &mut out),
            Err(_) => alive = false,
        }
    }
    if alive {
        Q.lock().unwrap().worker = Some(w);
    } else {
        kill_group(w.child.id());
        let _ = w.child.wait();
        while let Ok(ev) = w.rx.try_recv() {
            on_event(id, &ev, &mut out);
        }
        if out.error.is_none() {
            out.error = Some(format!("el motor se cerró: {}", out.tail.last().map(String::as_str).unwrap_or("")));
        }
    }
    out
}

fn run_proc(id: &str, step: &Step) -> Out {
    let mut cmd = if step.node {
        let mut c = Command::new("node");
        c.arg(app_dir().join(format!("{}.mjs", step.cmd))).args(&step.args).current_dir(app_dir());
        c
    } else {
        let mut a = vec![step.cmd.clone()];
        a.extend(step.args.clone());
        hub(&a)
    };
    let mut child = match cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).process_group(0).spawn() {
        Ok(c) => c,
        Err(e) => return Out { error: Some(format!("no se pudo lanzar {}: {e}", step.cmd)), ..Default::default() },
    };
    if let Some(r) = Q.lock().unwrap().running.get_mut(id) {
        r.1 = Some(child.id());
    }
    let (tx, rx) = mpsc::channel();
    let err = read_stderr(child.stderr.take().unwrap(), tx.clone());
    let stdout = child.stdout.take().unwrap();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Ok(ev) = serde_json::from_str::<Value>(&line) {
                let _ = tx.send(ev);
            }
        }
    });
    let mut out = Out::default();
    // los dos lectores sueltan su `tx` al acabar: entonces el canal se cierra
    for ev in rx {
        on_event(id, &ev, &mut out);
    }
    let _ = err.join();
    let status = child.wait();
    if out.result.is_none() && out.error.is_none() {
        out.error = Some(format!(
            "{} salió con {}: {}",
            step.cmd,
            status.map(|s| s.to_string()).unwrap_or_default(),
            out.tail.last().map(String::as_str).unwrap_or("")
        ));
    }
    out
}

fn run_step(id: String, step: Step) {
    let out = if step.res == Res::Gpu { run_gpu(&id, &step) } else { run_proc(&id, &step) };
    {
        let mut q = Q.lock().unwrap();
        q.running.remove(&id);
        let Some(j) = q.jobs.iter_mut().find(|j| j.id == id) else { return };
        if j.status == "running" {
            match (out.error, out.result) {
                (Some(e), _) => {
                    j.steps[j.cur].status = "error".into();
                    finish(&mut q, &id, "error", e);
                }
                (None, r) => {
                    let r = r.unwrap_or(Value::Null);
                    j.steps[j.cur].status = if r["skipped"] == true { "skipped" } else { "done" }.into();
                    j.result = r;
                    j.cur += 1;
                    j.pct = None;
                    let key = j.key.clone();
                    if j.cur >= j.steps.len() {
                        finish(&mut q, &id, "done", String::new());
                    } else {
                        j.status = "ready".into();
                        changed(&key); // cada paso deja algo nuevo (audio, voz, letra…)
                    }
                }
            }
        }
    }
    tick();
}

fn cancel_locked(q: &mut Queue, id: &str) {
    let Some(j) = q.jobs.iter().find(|j| j.id == id) else { return };
    if j.finished() {
        return;
    }
    if let Some((res, pid)) = q.running.get(id).copied() {
        if let Some(pid) = pid {
            kill_group(pid); // el hilo del paso lo ve morir y lo deja como está (cancelado)
        }
        if res == Res::Gpu {
            q.last_model = None;
        }
    }
    finish(q, id, "canceled", String::new());
}

// ---------------------------------------------------------------- comandos

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn paths_cmd() -> Paths {
    paths().clone()
}

#[tauri::command]
async fn catalog() -> Result<Value, String> {
    blocking(|| hub_once(&["catalog".into()]).map(|d| d["songs"].clone())).await
}

#[tauri::command]
async fn song(key: String) -> Result<Value, String> {
    blocking(move || hub_once(&["song".into(), key]).map(|d| d["song"].clone())).await
}

/// Órdenes inmediatas (no van a la cola): rápidas o que la vista espera.
#[tauri::command]
async fn run_cmd(cmd: String, args: Vec<String>) -> Result<Value, String> {
    const OK: [&str; 9] = ["ensemble", "restore", "delete", "search", "add", "assign", "plan", "unfail", "remote_list"];
    if !OK.contains(&cmd.as_str()) {
        return Err(format!("orden no permitida: {cmd}"));
    }
    let key = args.first().cloned().unwrap_or_default();
    let mutates = matches!(cmd.as_str(), "restore" | "delete" | "add" | "assign");
    if cmd == "delete" {
        // nada debe seguir escribiendo en lo que se borra
        let mut q = Q.lock().unwrap();
        let ids: Vec<String> = q.jobs.iter().filter(|j| j.key == key && !j.finished()).map(|j| j.id.clone()).collect();
        for id in ids {
            cancel_locked(&mut q, &id);
        }
    }
    let r = blocking(move || {
        let mut a = vec![cmd];
        a.extend(args);
        hub_once(&a)
    })
    .await;
    if mutates {
        changed(&key); // montar la partitura o buscar no cambian nada: avisar recargaría la vista en bucle
    }
    r
}

#[tauri::command]
fn enqueue(action: String, keys: Vec<String>, args: Option<Vec<String>>, then: Option<Vec<Vec<String>>>) -> Vec<String> {
    let ids = {
        let mut q = Q.lock().unwrap();
        enqueue_locked(&mut q, &action, &keys, &args.unwrap_or_default(), &then.unwrap_or_default())
    };
    tick();
    ids
}

/// Importar ficheros o enlaces: un paso de red cada uno; al acabar, encola `then` con la clave nueva.
#[tauri::command]
fn import(sources: Vec<String>, then: Option<Vec<Vec<String>>>) -> Vec<String> {
    let ids = {
        let mut q = Q.lock().unwrap();
        let then = then.unwrap_or_default();
        sources
            .into_iter()
            .map(|src| {
                let name = src.rsplit('/').next().unwrap_or(&src).to_string();
                let id = push(&mut q, "import", &src, vec![], vec![], then.clone());
                let j = q.jobs.iter_mut().find(|j| j.id == id).unwrap();
                if j.steps.is_empty() {
                    j.title = name;
                    j.steps = vec![Step { cmd: "import".into(), args: vec![src], res: Res::Net, label: "Importando".into(), model: None, node: false, status: String::new() }];
                }
                id
            })
            .collect()
    };
    tick();
    ids
}

#[tauri::command]
fn jobs() -> Value {
    snapshot(&Q.lock().unwrap())
}

#[tauri::command]
fn job(id: String) -> Value {
    Q.lock().unwrap().jobs.iter().find(|j| j.id == id).map(|j| json!(j)).unwrap_or(Value::Null)
}

#[tauri::command]
fn cancel(ids: Vec<String>) {
    {
        let mut q = Q.lock().unwrap();
        for id in ids {
            cancel_locked(&mut q, &id);
        }
        persist(&q);
    }
    tick();
}

#[tauri::command]
fn cancel_all() {
    let ids: Vec<String> = Q.lock().unwrap().jobs.iter().filter(|j| !j.finished()).map(|j| j.id.clone()).collect();
    cancel(ids);
}

#[tauri::command]
fn retry(ids: Vec<String>) {
    {
        let mut q = Q.lock().unwrap();
        for id in ids {
            let Some(j) = q.jobs.iter().find(|j| j.id == id && j.finished()).cloned() else { continue };
            let nid = push(&mut q, &j.action, &j.key, j.args.clone(), vec![], j.then.clone());
            if matches!(j.action.as_str(), "import" | "render") {
                let n = q.jobs.iter_mut().find(|x| x.id == nid).unwrap();
                n.title = j.title.clone();
                n.steps = j.steps.iter().cloned().map(|mut s| { s.status.clear(); s }).collect();
            }
        }
    }
    tick();
}

/// Al principio de la cola.
#[tauri::command]
fn top(ids: Vec<String>) {
    {
        let mut q = Q.lock().unwrap();
        let min = q.jobs.iter().map(|j| j.prio).fold(0.0, f64::min);
        for (k, id) in ids.iter().enumerate() {
            if let Some(j) = q.jobs.iter_mut().find(|j| &j.id == id) {
                j.prio = min - 1.0 + k as f64 * 1e-3;
            }
        }
    }
    tick();
}

#[tauri::command]
fn clear_finished() {
    Q.lock().unwrap().jobs.retain(|j| !j.finished());
    touch();
}

/// Escribe bytes (cuerpo crudo) en `path` (cabecera, encodeURIComponent), dentro de las carpetas de datos.
/// Solo JSON y PDF: ajustes, letras corregidas, proyectos, partituras exportadas.
#[tauri::command]
fn write_file(request: tauri::ipc::Request) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("se esperaban bytes".into());
    };
    let raw = request.headers().get("path").and_then(|v| v.to_str().ok()).ok_or("falta la cabecera path")?;
    let path = PathBuf::from(percent_decode(raw));
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("sin nombre")?.to_string();
    let media = path.parent().is_some_and(|p| p.ends_with("media"));
    if !(name.ends_with(".json") || name.ends_with(".pdf") || name.ends_with(".mid") || name == "playlists.txt" || media) || name.starts_with('.') {
        return Err(format!("no se escribe ese tipo de fichero: {name}"));
    }
    let dir = path.parent().ok_or("sin carpeta")?;
    if dir.components().any(|c| matches!(c, std::path::Component::ParentDir)) || !roots().iter().any(|r| dir.starts_with(r)) {
        return Err(format!("fuera de las carpetas de datos: {}", path.display()));
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let dir = inside(dir)?;
    let tmp = dir.join(format!(".{name}.tmp"));
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(&name)).map_err(|e| e.to_string())?;
    // una letra corregida cambia la canción (partitura, edits); ajustes de vista y proyectos, no
    if let (Some(stem), true) = (name.strip_suffix(".json"), dir.ends_with("lyrics")) {
        changed(stem);
    }
    Ok(())
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<Value>, String> {
    blocking(move || {
        let _ = std::fs::create_dir_all(&path);
        let dir = inside(Path::new(&path))?;
        let mut out = vec![];
        for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
            let m = e.metadata().map_err(|e| e.to_string())?;
            let modified = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs_f64()).unwrap_or(0.0);
            out.push(json!({"name": e.file_name().to_string_lossy(), "size": m.len(), "modified": modified, "dir": m.is_dir()}));
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
async fn remove_file(path: String) -> Result<(), String> {
    blocking(move || {
        let p = inside(Path::new(&path))?;
        if p.is_dir() {
            return Err("es una carpeta".into());
        }
        std::fs::remove_file(p).map_err(|e| e.to_string())
    })
    .await
}

/// Exportar un edit a MP4: Remotion en Node (el render necesita Chrome headless), como un trabajo más.
#[tauri::command]
fn render(key: String, name: String, props: Value) -> Result<String, String> {
    let dir = PathBuf::from(&paths().edits).join("renders");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '.' { c } else { '-' }).take(60).collect();
    let stamp = format!("{:x}", (now() * 1000.0) as u64);
    let props_file = PathBuf::from(&paths().data).join(format!(".render-{stamp}.json"));
    std::fs::write(&props_file, props.to_string()).map_err(|e| e.to_string())?;
    let out = dir.join(format!("{}-{stamp}.mp4", if safe.is_empty() { "edit".into() } else { safe }));
    let id = {
        let mut q = Q.lock().unwrap();
        let id = push(&mut q, "render", &key, vec![stamp], vec![], vec![]);
        let j = q.jobs.iter_mut().find(|j| j.id == id).unwrap();
        j.title = name;
        j.steps = vec![Step {
            cmd: "render".into(),
            args: vec![props_file.to_string_lossy().into(), out.to_string_lossy().into()],
            res: Res::Render,
            label: "Renderizando".into(),
            model: None,
            node: true,
            status: String::new(),
        }];
        id
    };
    tick();
    Ok(id)
}

/// Claude dirige el edit (plantilla, colores, destacados). Sin ANTHROPIC_API_KEY, null: el editor usa sus reglas.
#[tauri::command]
async fn director(brief: Value) -> Result<Value, String> {
    if std::env::var("ANTHROPIC_API_KEY").is_err() {
        return Ok(Value::Null);
    }
    blocking(move || {
        let mut child = Command::new("node")
            .arg(app_dir().join("director.mjs"))
            .current_dir(app_dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("node: {e}"))?;
        child.stdin.take().unwrap().write_all(brief.to_string().as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().lines().last().unwrap_or("Claude falló").to_string());
        }
        serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
fn has_director() -> bool {
    std::env::var("ANTHROPIC_API_KEY").is_ok()
}

const COACH: &str = "Eres profesor de piano y armonía. Te paso una sesión tocada en un teclado MIDI (JSON; el campo \"format\" \
explica los datos; los acordes los sacó un algoritmo sin IA y pueden fallar). Coméntasela a quien la tocó en español y en \
Markdown, bastante directo: sin introducciones, advertencias ni relleno; viñetas cortas. Cita cada momento como m:ss o m:ss.s \
(0:21, 2:38.4) y los tramos como m:ss–m:ss, nunca de otra forma. Secciones: ## Por tramos (cada zona de la sesión: qué se toca \
y qué sensación o emoción transmite), ## Progresiones (cada progresión que aparece, con sus acordes, las notas de cada uno y sus \
grados; qué sensación da y por qué, en breve) y ## Fallos (notas o acordes equivocados, acordes mal detectados, ritmo \
irregular). Sin tablas.";

/// Claude (Opus 5.5, esfuerzo medio) analiza una sesión del teclado con Claude Code (`claude -p`: la suscripción, sin API key) y lo deja al lado
/// como `<sesión>.analisis.md`.
#[tauri::command]
async fn analyze_session(path: String) -> Result<String, String> {
    blocking(move || {
        let json = inside(Path::new(&path))?;
        if json.extension().is_none_or(|e| e != "json") {
            return Err("no es una sesión".into());
        }
        let data = std::fs::read(&json).map_err(|e| e.to_string())?;
        // sin herramientas ni ajustes del usuario (hooks, plugins): solo el texto
        let mut child = Command::new("claude")
            .args(["-p", "--model", "claude-opus-5-5", "--effort", "medium", "--tools", "", "--setting-sources", "", "--no-session-persistence", "--system-prompt", COACH])
            .arg("Analiza esta sesión (JSON por la entrada estándar).")
            .current_dir(json.parent().ok_or("sin carpeta")?)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("falta Claude Code (claude en el PATH): {e}"))?;
        child.stdin.take().unwrap().write_all(&data).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !out.status.success() || text.is_empty() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(err.trim().lines().last().filter(|l| !l.is_empty()).unwrap_or(&text).to_string());
        }
        std::fs::write(json.with_extension("analisis.md"), &text).map_err(|e| e.to_string())?;
        Ok(text)
    })
    .await
}

#[tauri::command]
fn gpu_name() -> String {
    // «… Navi 23 [Radeon RX 6600/6600 XT/6600M] (rev c7)» -> «Radeon RX 6600/6600 XT/6600M»
    let out = Command::new("lspci").output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    let line = out.lines().find(|l| l.contains("VGA") || l.contains("3D controller") || l.contains("Display controller")).unwrap_or("");
    let line = line.split(" (rev").next().unwrap_or(line);
    line.rfind('[').and_then(|a| line[a + 1..].split(']').next()).unwrap_or("").to_string()
}

// ---------------------------------------------------------------- Spotify (lo que hacía Letras)

static NOW: LazyLock<Mutex<Value>> = LazyLock::new(|| Mutex::new(Value::Null));

/// Ajustes de la app (settings.json): «spotify» = sincronizar sola lo que suena (por defecto, sí).
fn spotify_on() -> bool {
    let f = PathBuf::from(&paths().data).join("settings.json");
    let v: Value = std::fs::read(f).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    v["spotify"].as_bool().unwrap_or(true)
}

fn read_player() -> Option<Value> {
    const FMT: &str = "{{status}}\t{{position}}\t{{mpris:length}}\t{{artist}}\t{{title}}\t{{album}}\t{{mpris:artUrl}}";
    let out = Command::new("playerctl").args(["-p", "spotify", "metadata", "--format", FMT]).output().ok()?;
    let line = String::from_utf8_lossy(&out.stdout);
    let f: Vec<&str> = line.trim_end_matches('\n').split('\t').collect();
    if f.len() != 7 || f[4].is_empty() {
        return None;
    }
    let secs = |s: &str| s.parse::<f64>().unwrap_or(0.0) / 1e6;
    Some(json!({"playing": f[0] == "Playing", "position": secs(f[1]), "duration": secs(f[2]), "artist": f[3], "title": f[4],
                "album": f[5], "art": f[6], "at": now()}))
}

/// Cada segundo mira Spotify (playerctl). Canción nueva: se registra y se busca su letra; si no trae tiempos, la IA
/// la sincroniza (como Letras). Va al principio de la cola: es lo que estás oyendo y lo que enseña el escritorio.
fn watch_spotify() {
    loop {
        thread::sleep(Duration::from_millis(1000));
        let p = read_player().unwrap_or(Value::Null);
        let (new_track, emit) = {
            let mut cur = NOW.lock().unwrap();
            let same = !p.is_null() && cur["title"] == p["title"] && cur["artist"] == p["artist"];
            // reloj: posición prevista desde la última lectura; si no cuadra (salto, pausa), se avisa
            let predicted = cur["position"].as_f64().unwrap_or(0.0)
                + if cur["playing"] == true { now() - cur["at"].as_f64().unwrap_or(now()) } else { 0.0 };
            let jumped = (p["position"].as_f64().unwrap_or(0.0) - predicted).abs() > 1.0;
            let emit = !same || cur["playing"] != p["playing"] || jumped;
            let key = if same { cur["key"].clone() } else { Value::Null };
            let mut next = p.clone();
            if !next.is_null() {
                next["key"] = key;
            }
            *cur = next;
            (!same && !p.is_null(), emit)
        };
        if emit {
            if let Some(app) = APP.get() {
                let _ = app.emit("player", NOW.lock().unwrap().clone());
            }
        }
        if new_track {
            let (artist, title) = (p["artist"].as_str().unwrap_or("").to_string(), p["title"].as_str().unwrap_or("").to_string());
            let dur = format!("{}", p["duration"].as_f64().unwrap_or(0.0).round());
            thread::spawn(move || {
                let Ok(r) = hub_once(&["add".into(), artist.clone(), title.clone(), dur]) else { return };
                let key = r["key"].as_str().unwrap_or("").to_string();
                {
                    let mut cur = NOW.lock().unwrap();
                    if cur["title"] != title.as_str() || cur["artist"] != artist.as_str() {
                        return; // ya suena otra
                    }
                    cur["key"] = json!(key);
                    if let Some(app) = APP.get() {
                        let _ = app.emit("player", cur.clone());
                    }
                }
                if !spotify_on() {
                    return;
                }
                {
                    let mut q = Q.lock().unwrap();
                    let id = if r["lyrics"] == true {
                        push(&mut q, "autosync", &key, vec![], vec![], vec![])
                    } else {
                        push(&mut q, "find", &key, vec![], vec![], vec![vec!["autosync".into()]])
                    };
                    let min = q.jobs.iter().map(|j| j.prio).fold(0.0, f64::min);
                    if let Some(j) = q.jobs.iter_mut().find(|j| j.id == id) {
                        j.prio = min - 1.0;
                    }
                }
                changed(&key);
                tick();
            });
        }
    }
}

#[tauri::command]
fn now_playing() -> Value {
    NOW.lock().unwrap().clone()
}

#[tauri::command]
fn player_seek(secs: f64) {
    let _ = Command::new("playerctl").args(["-p", "spotify", "position", &format!("{:.3}", secs.max(0.0))]).status();
}

#[tauri::command]
fn player_toggle() {
    let _ = Command::new("playerctl").args(["-p", "spotify", "play-pause"]).status();
}

/// El prefetch de las playlists (timer de systemd), ahora mismo.
#[tauri::command]
fn prefetch_now() -> Result<(), String> {
    let out = Command::new("systemctl").args(["--user", "start", "--no-block", "estudio-prefetch.service"]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

// ---------------------------------------------------------------- servidor de ficheros

/// Audio, partituras y fotos por HTTP con Range: el reproductor salta sin leer el WAV entero, y el render
/// (Chrome headless) lee lo mismo. Solo 127.0.0.1 y con un token aleatorio en la ruta: ninguna web puede pedirlo.
fn serve(listener: TcpListener) {
    for stream in listener.incoming().flatten() {
        thread::spawn(move || {
            let _ = handle_http(stream);
        });
    }
}

fn handle_http(mut stream: TcpStream) -> std::io::Result<()> {
    let mut head = Vec::new();
    let mut buf = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") && head.len() < 16384 {
        if stream.read(&mut buf)? == 0 {
            return Ok(());
        }
        head.push(buf[0]);
    }
    let head = String::from_utf8_lossy(&head);
    let mut lines = head.lines();
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, target) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    let range = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.eq_ignore_ascii_case("range"))
        .map(|(_, v)| v.trim().to_string());
    let cors = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Range\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length\r\n";
    if method == "OPTIONS" {
        return write!(stream, "HTTP/1.1 204 No Content\r\n{cors}Content-Length: 0\r\n\r\n");
    }
    let token = format!("/{}/", paths().token);
    let path = target.split('?').next().unwrap_or("");
    let file = path.strip_prefix(&token).map(|p| PathBuf::from(format!("/{}", percent_decode(p)))).and_then(|p| inside(&p).ok());
    let Some(file) = file.filter(|f| f.is_file()) else {
        return write!(stream, "HTTP/1.1 404 Not Found\r\n{cors}Content-Length: 0\r\n\r\n");
    };
    let mut f = std::fs::File::open(&file)?;
    let size = f.metadata()?.len();
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "json" => "application/json",
        "musicxml" | "xml" => "application/xml",
        "pdf" => "application/pdf",
        "mid" => "audio/midi",
        _ => "application/octet-stream",
    };
    let (start, end) = range.as_deref().and_then(|r| parse_range(r, size)).unwrap_or((0, size.saturating_sub(1)));
    let len = if size == 0 { 0 } else { end - start + 1 };
    let status = if range.is_some() && size > 0 { format!("206 Partial Content\r\nContent-Range: bytes {start}-{end}/{size}") } else { "200 OK".into() };
    write!(
        stream,
        "HTTP/1.1 {status}\r\n{cors}Content-Type: {mime}\r\nContent-Length: {len}\r\nAccept-Ranges: bytes\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
    )?;
    if method == "HEAD" || len == 0 {
        return Ok(());
    }
    use std::io::Seek;
    f.seek(std::io::SeekFrom::Start(start))?;
    std::io::copy(&mut f.take(len), &mut stream)?;
    Ok(())
}

/// "bytes=100-199" / "bytes=100-" / "bytes=-500" -> (inicio, fin incluido)
fn parse_range(r: &str, size: u64) -> Option<(u64, u64)> {
    let (a, b) = r.strip_prefix("bytes=")?.split(',').next()?.split_once('-')?;
    let last = size.checked_sub(1)?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => (size.saturating_sub(n.parse().ok()?), last),
        (s, "") => (s.parse().ok()?, last),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(last)),
    };
    (start <= end).then_some((start, end))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match (b[i], s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok())) {
            (b'%', Some(v)) => {
                out.push(v);
                i += 3;
            }
            (c, _) => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn token() -> String {
    let mut b = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = f.read_exact(&mut b);
    }
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn init() -> Result<(), String> {
    let p = hub_once(&["paths".into()])?;
    let port: u16 = std::env::var("ESTUDIO_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("puerto de ficheros: {e}"))?;
    let s = |k: &str| p[k].as_str().unwrap_or("").to_string();
    let _ = PATHS.set(Paths {
        letras: s("letras"),
        stemlab: s("stemlab"),
        data: s("data"),
        edits: s("edits"),
        port: listener.local_addr().map_err(|e| e.to_string())?.port(),
        token: token(),
    });
    let _ = std::fs::create_dir_all(&paths().data);
    // una sola app con la cola: dos retomarían los mismos trabajos de queue.json
    let lock = std::fs::File::create(PathBuf::from(&paths().data).join(".app.lock")).map_err(|e| e.to_string())?;
    if unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&lock), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("Estudio ya está abierto (o una prueba con datos reales está en marcha)".into());
    }
    static LOCK: OnceLock<std::fs::File> = OnceLock::new();
    let _ = LOCK.set(lock);
    thread::spawn(move || serve(listener));
    Ok(())
}

/// Al cerrar: mata lo que corre (la cola queda guardada y sigue al abrir).
fn shutdown() {
    let mut q = Q.lock().unwrap();
    persist(&q);
    for (_, (_, pid)) in q.running.drain() {
        if let Some(pid) = pid {
            kill_group(pid);
        }
    }
    if let Some(mut w) = q.worker.take() {
        kill_group(w.child.id());
        let _ = w.child.wait();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = init() {
        eprintln!("Estudio: {e}");
        std::process::exit(1);
    }
    restore_queue();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            paths_cmd, catalog, song, run_cmd, enqueue, import, jobs, job, cancel, cancel_all, retry, top, clear_finished, write_file, list_dir,
            remove_file, render, director, has_director, gpu_name, now_playing, player_seek, player_toggle, prefetch_now,
            analyze_session, midi::midi_ports, midi::midi_open, midi::midi_send, midi::midi_close
        ])
        .setup(|app| {
            let _ = APP.set(app.handle().clone());
            // eventos agrupados: como mucho ~8 por segundo aunque la GPU mande 100 barras de progreso
            thread::spawn(|| loop {
                thread::sleep(Duration::from_millis(120));
                if DIRTY.swap(false, Ordering::Relaxed) {
                    let jobs = snapshot(&Q.lock().unwrap());
                    let keys: Vec<String> = std::mem::take(&mut *CHANGED.lock().unwrap());
                    if let Some(app) = APP.get() {
                        let _ = app.emit("jobs", jobs);
                        if !keys.is_empty() {
                            let _ = app.emit("changed", keys);
                        }
                    }
                }
            });
            thread::spawn(watch_spotify);
            tick();
            // desarrollo: abrir otra página al arrancar (ESTUDIO_OPEN=http://localhost:1440/edit.html?song=…)
            #[cfg(debug_assertions)]
            if let (Ok(u), Some(w)) = (std::env::var("ESTUDIO_OPEN"), tauri::Manager::get_webview_window(app, "main")) {
                if let Ok(u) = u.parse() {
                    let _ = w.navigate(u);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error al arrancar Estudio");
    app.run(|_, e| {
        if let tauri::RunEvent::Exit = e {
            shutdown();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=500-5000", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=50-10", 1000), None);
        assert_eq!(parse_range("bytes=0-", 0), None);
    }

    #[test]
    fn decodes() {
        assert_eq!(percent_decode("%2Fdata%2F%C3%B1.pdf"), "/data/ñ.pdf");
        assert_eq!(tqdm_pct(" 41%|████      | 11/27 [00:27<00:06,  2.31it/s]"), Some(41));
        assert_eq!(tqdm_pct("MIOpen(HIP): Warning"), None);
    }

    fn job(q: &Queue, id: &str) -> Job {
        q.jobs.iter().find(|j| j.id == id).unwrap().clone()
    }

    #[test]
    fn queue_rules() {
        let _ = PATHS.set(Paths { letras: "/nonexistent".into(), stemlab: "/tmp".into(), data: "/tmp".into(), edits: "/tmp".into(), port: 0, token: "t".into() });
        let mut q = Queue::default();
        // misma acción dos veces = un trabajo
        let a = push(&mut q, "separate", "k", vec![], vec![], vec![]);
        assert_eq!(push(&mut q, "separate", "k", vec![], vec![], vec![]), a);
        // la letra espera a la separación pendiente (blanda); las notas, dura
        let l = push(&mut q, "letra", "k", vec![], vec![], vec![]);
        assert!(job(&q, &l).after.iter().any(|d| d.id == a && !d.hard));
        let n = push(&mut q, "notes", "k", vec!["bass".into()], vec![], vec![]);
        assert!(job(&q, &n).after.iter().any(|d| d.id == a && d.hard));
        // si la separación falla: las notas también; la letra sigue
        finish(&mut q, &a, "error", "x".into());
        assert_eq!(job(&q, &n).status, "error");
        assert_eq!(job(&q, &l).status, "queued");
        // «todo»: 1 separación + búsqueda + sincronización + 5 notas, notas de voz tras la letra
        let ids = push_all(&mut q, "z", "");
        assert_eq!(ids.len(), 9);
        let voice = job(&q, ids.last().unwrap());
        assert_eq!(voice.args, vec!["vocals"]);
        assert_eq!(voice.after.len(), 2);
    }
}

#[cfg(test)]
mod real {
    use super::*;

    /// Trabajos de verdad con los motores y los datos reales: `cargo test -- --ignored --nocapture <nombre>`.
    /// ESTUDIO_TEST="acción clave [arg]".
    fn wait(ids: &[String]) -> Vec<Job> {
        let mut seen = std::collections::HashSet::new();
        let t0 = std::time::Instant::now();
        loop {
            thread::sleep(Duration::from_millis(500));
            let q = Q.lock().unwrap();
            let jobs: Vec<Job> = q.jobs.iter().filter(|j| ids.contains(&j.id)).cloned().collect();
            for j in &jobs {
                // solo los cambios (y el % de 10 en 10)
                let line = format!("{} {} {} {} {}", j.action, j.args.join(" "), j.status, j.label, j.pct.map(|p| (p / 10.0) as u32 * 10).map(|p| format!("{p}%")).unwrap_or_default());
                if seen.insert(line.clone()) {
                    eprintln!("[{:>4}s] {line} {}", t0.elapsed().as_secs(), j.waiting);
                }
            }
            if jobs.iter().all(|j| j.finished()) {
                return jobs;
            }
        }
    }

    #[test]
    #[ignore]
    fn real_job() {
        init().unwrap();
        let spec = std::env::var("ESTUDIO_TEST").expect("ESTUDIO_TEST=\"acción clave [arg]\"");
        let parts: Vec<String> = spec.split(' ').map(String::from).collect();
        let ids = {
            let mut q = Q.lock().unwrap();
            enqueue_locked(&mut q, &parts[0], &[parts[1].clone()], &parts[2..], &[])
        };
        tick();
        let t0 = std::time::Instant::now();
        for j in wait(&ids) {
            eprintln!("=> {} {}: {} {} ({:?})", j.action, j.args.join(" "), j.status, j.error, j.steps.iter().map(|s| format!("{}:{}:{}", s.cmd, s.res as u8, s.status)).collect::<Vec<_>>());
            assert_eq!(j.status, "done", "{}", j.error);
        }
        eprintln!("total {:?}", t0.elapsed());
        shutdown();
    }
}
