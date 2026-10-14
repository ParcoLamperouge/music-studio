/** Obras clásicas del curso y de la pestaña Obras: MIDI de Mutopia (public/obras/m<id>.mid), dominio público o
 * Creative Commons con atribución (créditos en public/obras/CREDITOS.md). Nivel orientativo: 1 primeras obras … 6 virtuosismo. */

export type Obra = { id: number; level: number; title: string; composer: string; years: string; license: string; style: string };

export const OBRA_LEVELS: [number, string][] = [[1, "Primeras obras"], [2, "Elemental"], [3, "Intermedio"], [4, "Intermedio alto"], [5, "Avanzado"], [6, "Virtuosismo"]];

export const OBRAS: Obra[] = [
 {
  "id": 75,
  "level": 1,
  "title": "Minueto en Sol mayor (BWV Anh. 114, Petzold)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 76,
  "level": 1,
  "title": "Minueto en Sol menor (BWV Anh. 115, Petzold)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 74,
  "level": 1,
  "title": "Minueto en Fa mayor (BWV Anh. 113)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 77,
  "level": 1,
  "title": "Minueto en Sol mayor (BWV Anh. 116)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 79,
  "level": 1,
  "title": "Musette en Re mayor (BWV Anh. 126)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 1612,
  "level": 1,
  "title": "Minueto en La menor (BWV Anh. 120)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 1013,
  "level": 1,
  "title": "Polonesa en Fa mayor (BWV Anh. 117a)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 647,
  "level": 1,
  "title": "Melodía (Álbum para la juventud, op. 68 n.º 1)",
  "composer": "R. Schumann",
  "years": "1810–1856",
  "license": "Creative Commons Attribution-ShareAlike 2.5",
  "style": "Romantic"
 },
 {
  "id": 650,
  "level": 1,
  "title": "Marcha militar (op. 68 n.º 2)",
  "composer": "R. Schumann",
  "years": "1810–1856",
  "license": "Creative Commons Attribution-ShareAlike 2.5",
  "style": "Romantic"
 },
 {
  "id": 651,
  "level": 1,
  "title": "Cancioncilla (op. 68 n.º 3)",
  "composer": "R. Schumann",
  "years": "1810–1856",
  "license": "Creative Commons Attribution-ShareAlike 3.0",
  "style": "Romantic"
 },
 {
  "id": 653,
  "level": 1,
  "title": "Pequeña pieza (op. 68 n.º 5)",
  "composer": "R. Schumann",
  "years": "1810–1856",
  "license": "Creative Commons Attribution-ShareAlike 2.5",
  "style": "Romantic"
 },
 {
  "id": 2060,
  "level": 1,
  "title": "Ejercicio de ocho compases n.º 1 (op. 821)",
  "composer": "C. Czerny",
  "years": "1791–1857",
  "license": "Public Domain",
  "style": "Technique"
 },
 {
  "id": 2061,
  "level": 1,
  "title": "Ejercicio de ocho compases n.º 2 (op. 821)",
  "composer": "C. Czerny",
  "years": "1791–1857",
  "license": "Public Domain",
  "style": "Technique"
 },
 {
  "id": 2062,
  "level": 1,
  "title": "Ejercicio de ocho compases n.º 3 (op. 821)",
  "composer": "C. Czerny",
  "years": "1791–1857",
  "license": "Public Domain",
  "style": "Technique"
 },
 {
  "id": 2146,
  "level": 1,
  "title": "Estudio melódico n.º 1 (op. 840)",
  "composer": "C. Czerny",
  "years": "1791–1857",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 2147,
  "level": 1,
  "title": "Estudio melódico n.º 2 (op. 840)",
  "composer": "C. Czerny",
  "years": "1791–1857",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 202,
  "level": 2,
  "title": "La candidez (op. 100 n.º 1)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 203,
  "level": 2,
  "title": "Arabesca (op. 100 n.º 2)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 218,
  "level": 2,
  "title": "Pastoral (op. 100 n.º 3)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 219,
  "level": 2,
  "title": "La pequeña reunión (op. 100 n.º 4)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 214,
  "level": 2,
  "title": "Inocencia (op. 100 n.º 5)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 215,
  "level": 2,
  "title": "Progreso (op. 100 n.º 6)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 1014,
  "level": 2,
  "title": "Minueto en Si bemol mayor (BWV Anh. 118)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 1016,
  "level": 2,
  "title": "Polonesa en Sol menor (BWV Anh. 119)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 1613,
  "level": 2,
  "title": "Minueto en Do menor (BWV Anh. 121)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 687,
  "level": 2,
  "title": "Pobre huerfanita (op. 68 n.º 6)",
  "composer": "R. Schumann",
  "years": "1810–1856",
  "license": "Creative Commons Attribution-ShareAlike 2.5",
  "style": "Romantic"
 },
 {
  "id": 655,
  "level": 2,
  "title": "El jinete salvaje (op. 68 n.º 8)",
  "composer": "R. Schumann",
  "years": "1810–1856",
  "license": "Creative Commons Attribution-ShareAlike 2.5",
  "style": "Romantic"
 },
 {
  "id": 659,
  "level": 2,
  "title": "El alegre campesino (op. 68 n.º 10)",
  "composer": "R. Schumann",
  "years": "1810–1856",
  "license": "Creative Commons Attribution-ShareAlike 2.5",
  "style": "Romantic"
 },
 {
  "id": 2080,
  "level": 2,
  "title": "Canción francesa antigua (op. 39 n.º 16)",
  "composer": "P. I. Tchaikovsky",
  "years": "1840–1893",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 2032,
  "level": 2,
  "title": "Oración de la mañana (op. 39 n.º 1)",
  "composer": "P. I. Tchaikovsky",
  "years": "1840–1893",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 232,
  "level": 2,
  "title": "Sonatina op. 20 n.º 1: Allegro",
  "composer": "F. Kuhlau",
  "years": "1786–1832",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 207,
  "level": 2,
  "title": "Sonatina op. 34",
  "composer": "J. André",
  "years": "1741–1799",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 69,
  "level": 3,
  "title": "Preludio pequeño en Re menor (BWV 926)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 493,
  "level": 3,
  "title": "Preludio pequeño en Do mayor (BWV 928)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 931,
  "level": 3,
  "title": "Para Elisa (WoO 59)",
  "composer": "L. V. Beethoven",
  "years": "1770–1827",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 777,
  "level": 3,
  "title": "Sonata op. 49 n.º 2: Tempo di Menuetto",
  "composer": "L. V. Beethoven",
  "years": "1770–1827",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 216,
  "level": 3,
  "title": "El arroyo límpido (op. 100 n.º 7)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 217,
  "level": 3,
  "title": "La graciosa (op. 100 n.º 8)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 220,
  "level": 3,
  "title": "La caza (op. 100 n.º 9)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 221,
  "level": 3,
  "title": "Tierna flor (op. 100 n.º 10)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 222,
  "level": 3,
  "title": "La lavandera (op. 100 n.º 11)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 227,
  "level": 3,
  "title": "Balada (op. 100 n.º 15)",
  "composer": "J. F. F. Burgmüller",
  "years": "1806–1874",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 1806,
  "level": 3,
  "title": "Marcha de los soldaditos de madera (op. 39 n.º 5)",
  "composer": "P. I. Tchaikovsky",
  "years": "1840–1893",
  "license": "Public Domain",
  "style": "March"
 },
 {
  "id": 504,
  "level": 3,
  "title": "Ensueño (Träumerei, Escenas de niños op. 15 n.º 7)",
  "composer": "R. Schumann",
  "years": "1810–1856",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 354,
  "level": 3,
  "title": "De países y gentes lejanas (op. 15 n.º 1)",
  "composer": "R. Schumann",
  "years": "1810–1856",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 2194,
  "level": 3,
  "title": "Hoja de álbum en Mi menor (op. 12 n.º 7)",
  "composer": "E. Grieg",
  "years": "1843–1907",
  "license": "Creative Commons Attribution-ShareAlike 4.0",
  "style": "Romantic"
 },
 {
  "id": 37,
  "level": 3,
  "title": "Gymnopédie n.º 1",
  "composer": "E. Satie",
  "years": "1866–1925",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 2035,
  "level": 3,
  "title": "Gnossienne n.º 1",
  "composer": "E. Satie",
  "years": "1866–1925",
  "license": "Creative Commons Attribution-ShareAlike 4.0",
  "style": "Modern"
 },
 {
  "id": 468,
  "level": 3,
  "title": "Preludio en Mi menor (op. 28 n.º 4)",
  "composer": "F. F. Chopin",
  "years": "1810–1849",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 470,
  "level": 3,
  "title": "Preludio en La mayor (op. 28 n.º 7)",
  "composer": "F. F. Chopin",
  "years": "1810–1849",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 40,
  "level": 4,
  "title": "Invención n.º 1 en Do mayor (BWV 772)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Creative Commons Attribution-ShareAlike 3.0",
  "style": "Baroque"
 },
 {
  "id": 67,
  "level": 4,
  "title": "Invención n.º 4 en Re menor (BWV 775)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 61,
  "level": 4,
  "title": "Invención n.º 8 en Fa mayor (BWV 779)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 998,
  "level": 4,
  "title": "Sonata facile K. 545: Allegro",
  "composer": "W. A. Mozart",
  "years": "1756–1791",
  "license": "Creative Commons Attribution-ShareAlike 3.0",
  "style": "Classical"
 },
 {
  "id": 472,
  "level": 4,
  "title": "Preludio en Do menor (op. 28 n.º 20)",
  "composer": "F. F. Chopin",
  "years": "1810–1849",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 5,
  "level": 4,
  "title": "Preludio en Do mayor (El clave bien temperado I, BWV 846)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 263,
  "level": 4,
  "title": "The Entertainer",
  "composer": "S. Joplin",
  "years": "1868–1917",
  "license": "Public Domain",
  "style": "Jazz"
 },
 {
  "id": 1888,
  "level": 4,
  "title": "En la gruta del rey de la montaña (op. 46 n.º 4)",
  "composer": "E. Grieg",
  "years": "1843–1907",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 1679,
  "level": 4,
  "title": "Canción de góndola veneciana (Romanzas sin palabras)",
  "composer": "F. Mendelssohn-Bartholdy",
  "years": "1809–1847",
  "license": "Creative Commons Attribution 3.0",
  "style": "Romantic"
 },
 {
  "id": 511,
  "level": 4,
  "title": "Vals en Si menor (op. 69 n.º 2)",
  "composer": "F. F. Chopin",
  "years": "1810–1849",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 1590,
  "level": 5,
  "title": "Nocturno en Mi bemol mayor (op. 9 n.º 2)",
  "composer": "F. F. Chopin",
  "years": "1810–1849",
  "license": "Creative Commons Attribution-ShareAlike 3.0",
  "style": "Romantic"
 },
 {
  "id": 1777,
  "level": 5,
  "title": "Arabesca n.º 1",
  "composer": "C. Debussy",
  "years": "1862–1918",
  "license": "Public Domain",
  "style": "Modern"
 },
 {
  "id": 295,
  "level": 5,
  "title": "Sonata Patética: Adagio cantabile",
  "composer": "L. V. Beethoven",
  "years": "1770–1827",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 108,
  "level": 5,
  "title": "Rondó alla turca (K. 331)",
  "composer": "W. A. Mozart",
  "years": "1756–1791",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 23,
  "level": 5,
  "title": "Maple Leaf Rag",
  "composer": "S. Joplin",
  "years": "1868–1917",
  "license": "Public Domain",
  "style": "Jazz"
 },
 {
  "id": 1551,
  "level": 5,
  "title": "Impromptu en Mi bemol mayor (D. 899 n.º 2)",
  "composer": "F. Schubert",
  "years": "1797–1828",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 4,
  "level": 5,
  "title": "Fuga en Do mayor (El clave bien temperado I, BWV 846)",
  "composer": "J. S. Bach",
  "years": "1685–1750",
  "license": "Public Domain",
  "style": "Baroque"
 },
 {
  "id": 483,
  "level": 5,
  "title": "Vals del minuto (op. 64 n.º 1)",
  "composer": "F. F. Chopin",
  "years": "1810–1849",
  "license": "Public Domain",
  "style": "Romantic"
 },
 {
  "id": 1778,
  "level": 6,
  "title": "Claro de luna (Suite bergamasque)",
  "composer": "C. Debussy",
  "years": "1862–1918",
  "license": "Public Domain",
  "style": "Modern"
 },
 {
  "id": 1693,
  "level": 6,
  "title": "Fantasía-Impromptu (op. 66)",
  "composer": "F. F. Chopin",
  "years": "1810–1849",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 1959,
  "level": 6,
  "title": "Balada n.º 1 (op. 23)",
  "composer": "F. F. Chopin",
  "years": "1810–1849",
  "license": "Creative Commons Attribution-ShareAlike 4.0",
  "style": "Romantic"
 },
 {
  "id": 299,
  "level": 6,
  "title": "Sonata Patética: Grave – Allegro",
  "composer": "L. V. Beethoven",
  "years": "1770–1827",
  "license": "Public Domain",
  "style": "Classical"
 },
 {
  "id": 914,
  "level": 6,
  "title": "Estudio en Do mayor (op. 10 n.º 1)",
  "composer": "F. F. Chopin",
  "years": "1810–1849",
  "license": "Public Domain",
  "style": "Romantic"
 }
];

export const obraUrl = (id: number) => `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${id}`;
