/** La canción cargada (la que tiene abierta SongView, aunque se esté en otra vista): el mini-reproductor de abajo la
 * muestra y la controla. Quien tiene el Player se engancha con attachDeck y mantiene al día playing/time/duration. */
export const deck = $state({ key: null as string | null, playing: false, time: 0, duration: 0 });

type Ctl = { toggle: () => void; seek: (t: number) => void };
let ctl: Ctl | null = null;

export const deckToggle = () => ctl?.toggle();
export const deckSeek = (t: number) => ctl?.seek(t);

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
