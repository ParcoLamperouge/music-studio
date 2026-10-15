/** La canción cargada (la que tiene montada SongView, aunque esté oculta en la rejilla de Biblioteca): el
 * mini-reproductor de abajo la muestra y la controla. Solo suena en Biblioteca: al salir, App la pausa.
 *
 * Contrato para quien tiene el Player (SongView):
 *   $effect(() => attachDeck(key, { toggle, seek }));                      // al montar; devuelve el desenganche
 *   $effect(() => void Object.assign(deck, { playing, time, duration }));  // duration > 0 = audio listo
 * Con eso basta: deckPause() y deckPlay() van por toggle(). */
export const deck = $state({
  key: null as string | null,
  playing: false,
  time: 0,
  duration: 0,
  /** canción que debe arrancar en cuanto su audio esté listo (▶ en una tarjeta de la rejilla) */
  autoplay: null as string | null,
  /** orden de la rejilla (filtro + orden), para anterior / siguiente */
  order: [] as string[],
});

type Ctl = { toggle: () => void; seek: (t: number) => void };
let ctl: Ctl | null = null;

export const deckToggle = () => ctl?.toggle();
export const deckSeek = (t: number) => ctl?.seek(t);
export const deckPause = () => void (deck.playing && ctl?.toggle());
/** Que suene `key`: si ya es la cargada, arranca; si no, quien la cargue (App) la pondrá en cuanto esté lista. */
export function deckPlay(key: string) {
  if (deck.key === key && deck.duration > 0) return void (!deck.playing && ctl?.toggle());
  deck.autoplay = key;
}

/** Devuelve con qué soltarlo (para un $effect). */
export function attachDeck(key: string, c: Ctl) {
  ctl = c;
  deck.key = key;
  return () => {
    if (ctl !== c) return;
    ctl = null;
    Object.assign(deck, { key: null, playing: false, time: 0, duration: 0 });
  };
}

// arranque pendiente: en cuanto la cargada es la pedida y tiene audio
$effect.root(() => {
  $effect(() => {
    if (deck.autoplay && deck.key === deck.autoplay && deck.duration > 0) {
      deck.autoplay = null;
      if (!deck.playing) ctl?.toggle();
    }
  });
});
