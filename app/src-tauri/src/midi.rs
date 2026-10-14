//! Teclado MIDI (modo Tocar): lo que se toca llega a la vista por un `Channel` y la vista puede mandarle mensajes
//! (el volumen, CC7) por el puerto de salida del mismo aparato. WebKitGTK no tiene Web MIDI: por eso va aquí.

use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use std::sync::Mutex;
use tauri::ipc::Channel;

static IN: Mutex<Option<MidiInputConnection<()>>> = Mutex::new(None);
static OUT: Mutex<Option<MidiOutputConnection>> = Mutex::new(None);

/// Aparato de un puerto ALSA: «Digital Piano:Digital Piano MIDI 1 20:0» → «Digital Piano».
fn device(port: &str) -> &str {
    port.split(':').next().unwrap_or(port)
}

#[tauri::command]
pub fn midi_ports() -> Result<Vec<String>, String> {
    let midi = MidiInput::new("Estudio").map_err(|e| e.to_string())?;
    Ok(midi.ports().iter().filter_map(|p| midi.port_name(p).ok()).filter(|n| !n.starts_with("Midi Through")).collect())
}

/// Abre `name` y manda cada mensaje (nota, pedal…) tal cual. Devuelve si hay salida para el volumen.
#[tauri::command]
pub fn midi_open(name: String, on: Channel<Vec<u8>>) -> Result<bool, String> {
    midi_close();
    let midi = MidiInput::new("Estudio").map_err(|e| e.to_string())?;
    let port = midi.ports().into_iter().find(|p| midi.port_name(p).is_ok_and(|n| n == name)).ok_or("el aparato ya no está conectado")?;
    let conn = midi
        .connect(&port, "estudio-in", move |_, msg, _| drop(on.send(msg.to_vec())), ())
        .map_err(|e| e.to_string())?;
    *IN.lock().unwrap() = Some(conn);
    // la salida del mismo aparato: el mismo nombre, o al menos el mismo aparato
    let out = MidiOutput::new("Estudio").map_err(|e| e.to_string())?;
    let ports = out.ports();
    let names: Vec<String> = ports.iter().map(|p| out.port_name(p).unwrap_or_default()).collect();
    let i = names.iter().position(|n| *n == name).or_else(|| names.iter().position(|n| device(n) == device(&name)));
    if let Some(i) = i {
        *OUT.lock().unwrap() = out.connect(&ports[i], "estudio-out").ok();
    }
    Ok(OUT.lock().unwrap().is_some())
}

#[tauri::command]
pub fn midi_send(msg: Vec<u8>) -> Result<(), String> {
    match OUT.lock().unwrap().as_mut() {
        Some(c) => c.send(&msg).map_err(|e| e.to_string()),
        None => Err("el aparato no tiene salida MIDI".into()),
    }
}

#[tauri::command]
pub fn midi_close() {
    if let Some(c) = IN.lock().unwrap().take() {
        c.close();
    }
    if let Some(c) = OUT.lock().unwrap().take() {
        c.close();
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn device() {
        assert_eq!(super::device("Digital Piano:Digital Piano MIDI 1 20:0"), "Digital Piano");
    }
}
