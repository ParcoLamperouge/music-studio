/** El curso: de cero a experto, con la teoría dentro de cada lección y la práctica justo detrás (lo que se explica, se
 * toca: ejercicio, canción u obra). Las lecciones van en etapas (el orden recomendado), pero se pueden abrir en cualquier
 * orden: cada una dice qué conviene saber antes y con qué se complementa. Contenido propio, de teoría estándar. */

import type { Hands } from "./exercises.ts";
import type { Level } from "./arrange.ts";

export type Area = "Teclado" | "Ritmo" | "Lectura" | "Técnica" | "Intervalos" | "Escalas" | "Acordes" | "Armonía" | "Expresión" | "Oído" | "Repertorio";
export type Quiz = "intervalos-basicos" | "intervalos" | "mayor-menor" | "acordes" | "septimas";
export type Practice =
  | { kind: "ejercicio"; id: string; key?: string; hands?: Hands } // key: «Sol», «Re menor»…
  | { kind: "cancion"; id: string; hands?: Hands; level?: Level }
  | { kind: "obra"; id: number; hands?: Hands; level?: Level }
  | { kind: "oido"; quiz: Quiz };
/** Un paso: teoría (texto, con teclas que se ven y se oyen) o práctica (con el porcentaje al que se da por buena). */
export type Step =
  | { t: string; keys?: string[]; together?: boolean }
  | { p: Practice; title: string; goal?: number };
export type Lesson = { id: string; stage: number; area: Area; title: string; summary: string; requires?: string[]; related?: string[]; steps: Step[] };

export const STAGES = [
  "Primeros pasos", "El ritmo", "Leer música", "Las dos manos", "Intervalos y escalas", "Acordes",
  "Primeras obras", "Tonalidad menor y armonía", "Técnica", "Expresión y repertorio", "Armonía avanzada y polifonía", "Hacia el virtuosismo",
];

export const LESSONS: Lesson[] = [
  // ================================================================ 1 · Primeros pasos
  {
    id: "teclado", stage: 1, area: "Teclado", title: "Conoce el teclado", summary: "Teclas blancas y negras, y cómo encontrar cualquier nota.",
    related: ["primeras-notas"],
    steps: [
      { t: "¡Bienvenido! El piano tiene teclas **blancas** y **negras**. Las negras van en grupos de **dos** y de **tres**, una y otra vez: es el mapa del teclado. Toca un grupo de dos y uno de tres.", keys: ["Do#4", "Re#4", "Fa#4", "Sol#4", "La#4"] },
      { t: "Las notas se llaman **Do, Re, Mi, Fa, Sol, La, Si** y vuelven a empezar. El **Do** es la blanca justo a la izquierda del grupo de **dos** negras. El que queda en medio del piano es el **Do central** (Do4).", keys: ["Do4", "Re4", "Mi4", "Fa4", "Sol4", "La4", "Si4", "Do5"] },
      { p: { kind: "ejercicio", id: "grupos-negras" }, title: "Toca los grupos de teclas negras" },
      { p: { kind: "ejercicio", id: "encuentra-do" }, title: "Encuentra todos los Do" },
      { t: "Cada Do suena «igual» pero más agudo o más grave: es la misma nota en otra **octava**. Por eso se numeran: Do3, Do4 (central), Do5…", keys: ["Do3", "Do4", "Do5"] },
    ],
  },
  {
    id: "postura", stage: 1, area: "Técnica", title: "Postura y números de los dedos", summary: "Cómo sentarse, la mano redonda y los dedos del 1 al 5.",
    related: ["primeras-notas"],
    steps: [
      { t: "Siéntate en el centro, frente al Do central, con los codos un poco por delante del cuerpo y los hombros sueltos. La mano, **redondeada**, como si sujetaras una pelota pequeña; tocas con la yema, no con la uña." },
      { t: "Los dedos se numeran igual en las dos manos: **1 el pulgar**, 2 el índice, 3 el corazón, 4 el anular y 5 el meñique. En las partituras ese número encima de la nota dice qué dedo usar." },
      { t: "**Posición de Do** con la derecha: pulgar (1) en el Do central y un dedo en cada tecla hasta el Sol (5). Con la izquierda, el meñique (5) en el Do de abajo y el pulgar en el Sol.", keys: ["Do4", "Re4", "Mi4", "Fa4", "Sol4"] },
      { p: { kind: "ejercicio", id: "cinco-dedos", hands: "rh" }, title: "Cinco dedos con la derecha" },
      { p: { kind: "ejercicio", id: "cinco-dedos", hands: "lh" }, title: "Cinco dedos con la izquierda" },
    ],
  },
  {
    id: "primeras-notas", stage: 1, area: "Repertorio", title: "Tus primeras canciones", summary: "Melodías de tres y cuatro notas con la derecha.",
    requires: ["postura"],
    steps: [
      { t: "Con solo **tres notas** (Mi, Re, Do: dedos 3, 2 y 1) ya hay canción. Escúchala primero y luego tócala: con «Espera» puesta, la canción te espera en cada nota.", keys: ["Mi4", "Re4", "Do4"] },
      { p: { kind: "cancion", id: "panecillos", hands: "rh" }, title: "Panecillos calientes" },
      { t: "Ahora cuatro notas: añade el **Sol** con el meñique. Fíjate en que muchas notas se repiten: misma tecla, la mano quieta.", keys: ["Do4", "Re4", "Mi4", "Sol4"] },
      { p: { kind: "cancion", id: "maria", hands: "rh" }, title: "María tenía un corderito" },
      { p: { kind: "cancion", id: "estrellita", hands: "rh" }, title: "Estrellita, ¿dónde estás?" },
    ],
  },

  // ================================================================ 2 · El ritmo
  {
    id: "pulso-figuras", stage: 2, area: "Ritmo", title: "El pulso y las figuras", summary: "Negra, blanca y redonda: cuánto dura cada nota.",
    related: ["corcheas-silencios", "pentagrama"],
    steps: [
      { t: "La música tiene un **pulso** regular, como un reloj o el corazón: es lo que marcas con el pie. Cada nota dura un número de pulsos." },
      { t: "La **negra** dura 1 pulso, la **blanca** 2 y la **redonda** 4. Cuenta en voz alta «1, 2, 3, 4» mientras tocas, y suelta la tecla justo cuando acaba cada figura." },
      { p: { kind: "ejercicio", id: "cinco-dedos-ritmo", hands: "rh" }, title: "Negras, blancas y redondas" },
      { p: { kind: "cancion", id: "luna", hands: "rh" }, title: "Au clair de la lune" },
    ],
  },
  {
    id: "corcheas-silencios", stage: 2, area: "Ritmo", title: "Corcheas y silencios", summary: "Dos notas por pulso, y los silencios que también se cuentan.",
    requires: ["pulso-figuras"],
    steps: [
      { t: "La **corchea** dura medio pulso: caben **dos en cada pulso**. Se cuentan «1 y 2 y 3 y 4 y»: el número cae en el pulso y la «y» justo a mitad." },
      { t: "Los **silencios** son pausas que duran lo mismo que su figura (silencio de negra, de blanca…). En un silencio se levanta la mano, pero el pulso sigue contando." },
      { p: { kind: "ejercicio", id: "corcheas", hands: "rh" }, title: "Corcheas en la escala" },
      { p: { kind: "cancion", id: "frere", hands: "rh" }, title: "Frère Jacques" },
      { p: { kind: "cancion", id: "panecillos", hands: "rh", level: 5 }, title: "Panecillos (las corcheas del medio)" },
    ],
  },
  {
    id: "compases", stage: 2, area: "Ritmo", title: "Compases y puntillo", summary: "Agrupar los pulsos de 2, 3 o 4, y la nota con puntillo.",
    requires: ["corcheas-silencios"],
    steps: [
      { t: "Los pulsos se agrupan en **compases**: de 4 (el más común, «1-2-3-4»), de 3 (el vals, «1-2-3») o de 2 (la marcha). El **1** de cada compás pesa un poco más." },
      { t: "El **puntillo** alarga una nota la mitad de lo que dura: una negra con puntillo dura 1 pulso y medio, y suele ir seguida de una corchea («Oda a la alegría»: «Mi-i Re Re»)." },
      { p: { kind: "cancion", id: "alegria", hands: "rh" }, title: "Oda a la alegría (puntillo al final de cada frase)" },
      { p: { kind: "cancion", id: "cumple", hands: "rh" }, title: "Cumpleaños feliz (compás de 3)" },
      { p: { kind: "cancion", id: "remar", hands: "rh" }, title: "Rema, rema (6/8: dos pulsos de tres)" },
    ],
  },

  // ================================================================ 3 · Leer música
  {
    id: "pentagrama", stage: 3, area: "Lectura", title: "El pentagrama y la clave de sol", summary: "Cinco líneas, y las notas de la mano derecha.",
    requires: ["teclado"],
    related: ["clave-fa"],
    steps: [
      { t: "La música se escribe en el **pentagrama**: 5 líneas y 4 espacios. Cuanto más arriba está la nota, más aguda. La **clave de sol** (la de la mano derecha) fija que la segunda línea empezando por abajo es el Sol4." },
      { t: "Truco: las notas de los **espacios** en clave de sol, de abajo arriba, son **Fa-La-Do-Mi**. Las de las **líneas**: **Mi-Sol-Si-Re-Fa**. El Do central va en una rayita por debajo del pentagrama.", keys: ["Fa4", "La4", "Do5", "Mi5"] },
      { t: "Mira la **Partitura** mientras practicas (botón arriba, a la derecha de «Piano roll»): cada nota que tocas se colorea. Así se aprende a leer con la música que ya conoces." },
      { p: { kind: "cancion", id: "estrellita", hands: "rh" }, title: "Estrellita mirando la partitura" },
      { p: { kind: "cancion", id: "puente", hands: "rh" }, title: "El puente de Londres" },
    ],
  },
  {
    id: "clave-fa", stage: 3, area: "Lectura", title: "La clave de fa", summary: "El pentagrama de la mano izquierda.",
    requires: ["pentagrama"],
    steps: [
      { t: "La mano izquierda se lee en **clave de fa**: la cuarta línea es el Fa3. Las notas de los espacios son **La-Do-Mi-Sol** y las de las líneas **Sol-Si-Re-Fa-La**. El Do central aquí va en una rayita por **encima**.", keys: ["La2", "Do3", "Mi3", "Sol3"] },
      { t: "En el piano se leen las dos claves a la vez: el **gran pentagrama**, unido por una llave. Arriba la derecha, abajo la izquierda." },
      { p: { kind: "ejercicio", id: "cinco-dedos", hands: "lh" }, title: "Cinco dedos con la izquierda, leyendo en clave de fa" },
      { p: { kind: "cancion", id: "maria", hands: "lh" }, title: "El bajo de «María» con la izquierda" },
    ],
  },
  {
    id: "alteraciones", stage: 3, area: "Lectura", title: "Sostenidos, bemoles y semitonos", summary: "Las teclas negras tienen nombre.",
    requires: ["teclado"],
    related: ["escala-mayor"],
    steps: [
      { t: "De una tecla a la de al lado (blanca o negra) hay un **semitono**, la distancia más pequeña. Dos semitonos son un **tono**. Entre Mi-Fa y Si-Do no hay negra: ahí ya hay un semitono entre blancas.", keys: ["Mi4", "Fa4", "Si4", "Do5"] },
      { t: "El **sostenido** (#) sube una nota un semitono y el **bemol** (b) la baja. La negra entre Do y Re se llama **Do#** o **Reb**: es la misma tecla con dos nombres.", keys: ["Do4", "Do#4", "Re4"] },
      { p: { kind: "ejercicio", id: "grupos-negras" }, title: "Las teclas negras" },
      { p: { kind: "cancion", id: "estrellita-sol", hands: "rh" }, title: "Estrellita empezando en Sol" },
    ],
  },

  // ================================================================ 4 · Las dos manos
  {
    id: "mano-izquierda", stage: 4, area: "Técnica", title: "La mano izquierda", summary: "Despertar la mano débil y turnarse entre manos.",
    requires: ["postura"],
    steps: [
      { t: "La izquierda suele ser la más torpe: dale el mismo cariño que a la derecha. En la izquierda la escala sube del **5 al 1**, al revés que en la derecha." },
      { p: { kind: "ejercicio", id: "cinco-dedos", hands: "lh" }, title: "Cinco dedos con la izquierda" },
      { p: { kind: "ejercicio", id: "manos-alternas" }, title: "Pregunta y respuesta entre manos" },
    ],
  },
  {
    id: "manos-juntas", stage: 4, area: "Técnica", title: "Manos juntas", summary: "Melodía arriba, bajo abajo.",
    requires: ["mano-izquierda", "pulso-figuras"],
    related: ["acompanar"],
    steps: [
      { t: "Primero cada mano sola, hasta que salga sin pensar. Luego juntas **muy despacio** (baja el tempo al 60-70 %), con la espera puesta. La izquierda hace notas largas: sujétalas mientras la derecha se mueve." },
      { p: { kind: "cancion", id: "maria", hands: "both" }, title: "María, con las dos manos" },
      { p: { kind: "cancion", id: "alegria", hands: "both" }, title: "Oda a la alegría, con las dos manos" },
      { p: { kind: "ejercicio", id: "contrario" }, title: "Movimiento contrario" },
    ],
  },
  {
    id: "dinamica", stage: 4, area: "Expresión", title: "Suave y fuerte", summary: "Piano, forte y crescendo.",
    requires: ["primeras-notas"],
    related: ["fraseo"],
    steps: [
      { t: "La fuerza con la que tocas se llama **dinámica**. En la partitura: **p** (piano, suave), **f** (forte, fuerte), **mf** (medio fuerte), y una cuña que se abre para ir creciendo (**crescendo**)." },
      { t: "No se toca fuerte apretando los dedos, sino dejando caer **el peso del brazo**. Y suave, con el brazo ligero. Con un teclado MIDI, la app te pinta en amarillo las notas que se pasan de fuerza." },
      { p: { kind: "ejercicio", id: "dinamicas", hands: "rh" }, title: "Piano, forte y crescendo" },
    ],
  },

  // ================================================================ 5 · Intervalos y escalas
  {
    id: "intervalos", stage: 5, area: "Intervalos", title: "Intervalos", summary: "La distancia entre dos notas, en el teclado y de oído.",
    requires: ["teclado"],
    related: ["triadas", "oido-intervalos"],
    steps: [
      { t: "Un **intervalo** es la distancia entre dos notas, contando las dos: de Do a Re una **segunda**, de Do a Mi una **tercera**, de Do a Sol una **quinta**, de Do al siguiente Do una **octava**.", keys: ["Do4", "Mi4"], together: true },
      { t: "Cada uno tiene su color: la **tercera** suena dulce, la **quinta** abierta y hueca, la **segunda** rozada. La **cuarta** y la **quinta** son las de «Here comes the bride» y el principio de «Estrellita» (Do-Sol).", keys: ["Do4", "Sol4"], together: true },
      { p: { kind: "ejercicio", id: "intervalos", hands: "rh" }, title: "Intervalos desde Do" },
      { p: { kind: "oido", quiz: "intervalos-basicos" }, title: "De oído: segunda, tercera, quinta u octava" },
    ],
  },
  {
    id: "oido-intervalos", stage: 5, area: "Oído", title: "Reconocer intervalos de oído", summary: "Asociar cada distancia a una canción que ya conoces.",
    requires: ["intervalos"],
    related: ["oido-acordes"],
    steps: [
      { t: "El truco de los músicos: asociar cada intervalo al principio de una canción. **Segunda mayor**: «Frère Jacques» (Do-Re). **Tercera mayor**: «Oh when the saints» (Do-Mi). **Cuarta**: «Here comes the bride». **Quinta**: «Estrellita» (Do-Sol). **Octava**: «Somewhere over the rainbow».", keys: ["Do4", "Sol4"] },
      { t: "Escucha primero si suena **cerca o lejos**, luego si suena **dulce** (terceras, sextas), **abierto** (cuartas, quintas, octavas) o **rozado** (segundas, séptimas). Con la práctica se reconoce sin pensar." },
      { p: { kind: "oido", quiz: "intervalos-basicos" }, title: "Segunda, tercera, quinta u octava" },
      { p: { kind: "oido", quiz: "intervalos" }, title: "Todos los intervalos" },
    ],
  },
  {
    id: "escala-mayor", stage: 5, area: "Escalas", title: "La escala mayor", summary: "La fórmula de tonos y semitonos y el paso del pulgar.",
    requires: ["alteraciones"],
    related: ["tonalidades", "triadas"],
    steps: [
      { t: "La **escala mayor** son 8 notas de tónica a tónica con una fórmula fija de distancias: **tono, tono, semitono, tono, tono, tono, semitono**. Empezando en Do sale con solo teclas blancas.", keys: ["Do4", "Re4", "Mi4", "Fa4", "Sol4", "La4", "Si4", "Do5"] },
      { t: "Para tocar 8 notas con 5 dedos: con la derecha, **el pulgar pasa por debajo** después del 3 (Do-Re-Mi, pulgar en Fa). Con la izquierda, al subir, **el 3 cruza por encima** del pulgar. Sin girar la muñeca." },
      { p: { kind: "ejercicio", id: "escala-una-octava-do", key: "Do", hands: "rh" }, title: "Escala de Do, derecha" },
      { p: { kind: "ejercicio", id: "escala-una-octava-do", key: "Do", hands: "lh" }, title: "Escala de Do, izquierda" },
      { p: { kind: "ejercicio", id: "contrario", key: "Do" }, title: "Escala en movimiento contrario" },
    ],
  },
  {
    id: "tonalidades", stage: 5, area: "Escalas", title: "Tonalidades y armaduras", summary: "La escala mayor desde cualquier nota.",
    requires: ["escala-mayor"],
    steps: [
      { t: "Si aplicas la misma fórmula empezando en **Sol**, al llegar al séptimo grado necesitas **Fa#**: la escala de Sol mayor tiene un sostenido. Esa es su **armadura**, que se escribe al principio del pentagrama.", keys: ["Sol4", "La4", "Si4", "Do5", "Re5", "Mi5", "Fa#5", "Sol5"] },
      { t: "Cada quinta hacia arriba añade un sostenido: Do (0), Sol (1#), Re (2#), La (3#)… y cada quinta hacia abajo un bemol: Fa (1b), Sib (2b), Mib (3b)… Es el **círculo de quintas**." },
      { p: { kind: "ejercicio", id: "escala-una-octava-do", key: "Sol" }, title: "Escala de Sol mayor" },
      { p: { kind: "ejercicio", id: "escala-una-octava-do", key: "Re" }, title: "Escala de Re mayor" },
      { p: { kind: "ejercicio", id: "escala-una-octava-do", key: "Fa" }, title: "Escala de Fa mayor (pulgar tras el 4 en la derecha)" },
      { p: { kind: "cancion", id: "estrellita-sol", hands: "both" }, title: "Estrellita en Sol, con las dos manos" },
    ],
  },

  {
    id: "todas-mayores", stage: 5, area: "Escalas", title: "Las doce tonalidades mayores", summary: "Todas las escalas mayores y cómo digitarlas.",
    requires: ["tonalidades"],
    related: ["todas-menores"],
    steps: [
      { t: "Hay **12 escalas mayores**, una por cada tecla. Siguiendo el **círculo de quintas** (Do, Sol, Re, La, Mi, Si, Fa#…) cada una tiene un sostenido más que la anterior; y hacia el otro lado (Fa, Sib, Mib, Lab, Reb…) un bemol más." },
      { t: "Digitación, la regla de oro: **el pulgar nunca en tecla negra**. Do, Sol, Re, La y Mi mayor se tocan igual con la derecha (**1-2-3, 1-2-3-4-5**); Fa mayor cambia (1-2-3-4, 1-2-3-4) para que el pulgar no caiga en el Sib. En las de muchos bemoles el pulgar va en las blancas (Do y Fa)." },
      { p: { kind: "ejercicio", id: "escala-una-octava-do", key: "La", hands: "both" }, title: "La mayor, manos juntas" },
      { p: { kind: "ejercicio", id: "escala-una-octava-do", key: "Mib", hands: "rh" }, title: "Mib mayor (pulgar en Fa y Do)" },
      { p: { kind: "ejercicio", id: "escalas-mayores-todas", hands: "rh" }, title: "Las doce, por el círculo de quintas" },
    ],
  },
  // ================================================================ 6 · Acordes
  {
    id: "triadas", stage: 6, area: "Acordes", title: "¿Qué es un acorde?", summary: "Tres notas a la vez: la tríada.",
    requires: ["intervalos"],
    related: ["acompanar", "oido-acordes"],
    steps: [
      { t: "Un **acorde** son varias notas que suenan a la vez. El más básico, la **tríada**, se forma con notas alternas de la escala: la **fundamental**, la **tercera** y la **quinta**. Do-Mi-Sol es el acorde de **Do mayor**.", keys: ["Do4", "Mi4", "Sol4"], together: true },
      { t: "En la mano: dedos **1-3-5**, saltando una tecla blanca entre cada uno. Con la izquierda, 5-3-1. Bájalos los tres exactamente a la vez." },
      { t: "Con tres acordes se acompañan miles de canciones: **Do (I)**, **Fa (IV)** y **Sol (V)**. Fíjate: cada uno es una tríada sobre una nota de la escala.", keys: ["Fa4", "La4", "Do5"], together: true },
      { p: { kind: "ejercicio", id: "acordes-I-IV-V", key: "Do", hands: "rh" }, title: "Toca Do, Fa y Sol" },
      { p: { kind: "cancion", id: "alegria-acordes", hands: "both" }, title: "Canción con acordes: Oda a la alegría" },
    ],
  },
  {
    id: "mayor-menor", stage: 6, area: "Acordes", title: "Acordes mayores y menores", summary: "Una sola nota cambia el color.",
    requires: ["triadas"],
    steps: [
      { t: "Bajando **la nota del medio** un semitono, un acorde mayor se vuelve **menor**: Do-Mi-Sol → Do-**Mib**-Sol. El mayor suena luminoso; el menor, más íntimo o triste.", keys: ["Do4", "Re#4", "Sol4"], together: true },
      { t: "Medido en semitonos: el mayor es **4 + 3** (tercera mayor y luego menor), el menor **3 + 4**. En los nombres: «Do» es mayor y «Dom» (o «Cm») menor." },
      { p: { kind: "ejercicio", id: "mayor-menor", key: "Do", hands: "rh" }, title: "Parejas mayor-menor" },
      { p: { kind: "oido", quiz: "mayor-menor" }, title: "De oído: ¿mayor o menor?" },
    ],
  },
  {
    id: "oido-acordes", stage: 6, area: "Oído", title: "Reconocer acordes de oído", summary: "Mayor, menor, disminuido y aumentado.",
    requires: ["mayor-menor"],
    related: ["oido-intervalos"],
    steps: [
      { t: "Los cuatro tipos de tríada: **mayor** (4+3 semitonos, luminoso), **menor** (3+4, íntimo), **disminuido** (3+3, tenso, inestable) y **aumentado** (4+4, extraño, suspendido). Escucha cada uno sobre Do.", keys: ["Do4", "Mi4", "Sol#4"], together: true },
      { p: { kind: "oido", quiz: "mayor-menor" }, title: "¿Mayor o menor?" },
      { p: { kind: "oido", quiz: "acordes" }, title: "Los cuatro tipos de acorde" },
      { t: "Con una nota más arriba salen las **cuatriadas**: **maj7** (mayor con la 7.ª mayor, suave, jazz), **7** (mayor con la 7.ª menor, la dominante: pide resolver), **m7** (menor con 7.ª menor, relajado) y **m7(b5)** (el semidisminuido, oscuro). Para más (sus, dim7, grados, progresiones, dictado y trozos de tus canciones), el botón **♪ Oído** del curso.", keys: ["Do4", "Mi4", "Sol4", "Sib4"], together: true },
      { p: { kind: "oido", quiz: "septimas" }, title: "Acordes de séptima" },
    ],
  },
  {
    id: "acompanar", stage: 6, area: "Acordes", title: "Acompañar una canción", summary: "Bajo con la izquierda, acorde con la derecha.",
    requires: ["triadas", "manos-juntas"],
    steps: [
      { t: "La forma más simple de acompañar: la izquierda toca la **nota del acorde** (el bajo) y la derecha el **acorde entero**. Cuando la canción dice «Do», tocas Do abajo y Do-Mi-Sol arriba." },
      { p: { kind: "ejercicio", id: "progresion-I-IV-V-I", key: "Do" }, title: "I–IV–V–I: bajo y acorde" },
      { p: { kind: "cancion", id: "estrellita", hands: "both" }, title: "Estrellita con su acompañamiento" },
      { p: { kind: "cancion", id: "cascabeles", hands: "both" }, title: "Jingle Bells con las dos manos" },
    ],
  },
  {
    id: "inversiones", stage: 6, area: "Acordes", title: "Inversiones", summary: "Las mismas notas en otro orden, para no saltar.",
    requires: ["triadas"],
    related: ["progresiones-pop"],
    steps: [
      { t: "Un acorde no tiene por qué empezar por su fundamental. **Primera inversión**: la tercera abajo (Mi-Sol-Do). **Segunda**: la quinta abajo (Sol-Do-Mi). Siguen siendo Do mayor.", keys: ["Mi4", "Sol4", "Do5"], together: true },
      { t: "Sirven para **enlazar** acordes moviendo poco la mano: de Do (Do-Mi-Sol) a Fa no hace falta saltar, vale Do-Fa-La (Fa en segunda inversión): el Do se queda quieto.", keys: ["Do4", "Fa4", "La4"], together: true },
      { p: { kind: "ejercicio", id: "inversiones", key: "Do", hands: "rh" }, title: "Las tres posiciones" },
      { p: { kind: "ejercicio", id: "progresion-enlazada", key: "Do" }, title: "I–vi–IV–V bien enlazados" },
    ],
  },

  // ================================================================ 7 · Primeras obras
  {
    id: "minueto", stage: 7, area: "Repertorio", title: "Tu primera obra clásica: el Minueto en Sol", summary: "El famoso minueto del cuaderno de Anna Magdalena Bach.",
    requires: ["manos-juntas", "compases"],
    steps: [
      { t: "Un **minueto** es un baile elegante en compás de 3. Este (de Christian Petzold, atribuido mucho tiempo a Bach) es de las primeras obras que toca todo pianista. Está en **Sol mayor**: acuérdate del Fa#." },
      { t: "Apréndelo **por niveles**: en el 1, la melodía simplificada con una nota de bajo; súbelo cuando te salga. Y practica las **zonas difíciles** que te marque la barra de compases." },
      { p: { kind: "obra", id: 75, level: 2 }, title: "Minueto en Sol: nivel 2 (simplificado)" },
      { p: { kind: "obra", id: 75, hands: "rh", level: 5 }, title: "Minueto en Sol: la derecha, tal cual" },
      { p: { kind: "obra", id: 75, level: 5 }, title: "Minueto en Sol completo" },
    ],
  },
  {
    id: "estudios", stage: 7, area: "Técnica", title: "Estudios: Czerny", summary: "Piezas cortas para soltar los dedos.",
    requires: ["manos-juntas"],
    steps: [
      { t: "Un **estudio** es una pieza pensada para trabajar una dificultad concreta. Carl Czerny, alumno de Beethoven, escribió cientos. Estos de ocho compases son perfectos para practicar cada día: cortos y regulares." },
      { p: { kind: "obra", id: 2060, level: 5 }, title: "Czerny: ejercicio de ocho compases n.º 1" },
      { p: { kind: "obra", id: 2061, level: 5 }, title: "Czerny: ejercicio de ocho compases n.º 2" },
      { p: { kind: "obra", id: 2146, level: 5 }, title: "Czerny: estudio melódico n.º 1" },
    ],
  },
  {
    id: "album-juventud", stage: 7, area: "Repertorio", title: "Schumann y el Álbum para la juventud", summary: "Piezas románticas escritas para aprender.",
    requires: ["manos-juntas"],
    related: ["fraseo"],
    steps: [
      { t: "Robert Schumann escribió el **Álbum para la juventud** para sus hijas: piezas cortas, cada una con su carácter. La «Melodía» es un canto tranquilo con la derecha sobre un acompañamiento de la izquierda." },
      { p: { kind: "obra", id: 647, level: 3 }, title: "Melodía (op. 68 n.º 1): nivel 3" },
      { p: { kind: "obra", id: 647, level: 5 }, title: "Melodía, tal cual" },
      { p: { kind: "obra", id: 650, level: 5 }, title: "Marcha militar (op. 68 n.º 2)" },
    ],
  },

  // ================================================================ 8 · Tonalidad menor y armonía
  {
    id: "escalas-menores", stage: 8, area: "Escalas", title: "Las escalas menores", summary: "Natural, armónica y melódica.",
    requires: ["escala-mayor"],
    related: ["mayor-menor"],
    steps: [
      { t: "La **menor natural** tiene la fórmula **tono, semitono, tono, tono, semitono, tono, tono**. La de **La menor** son las mismas teclas blancas que Do mayor, empezando en La: son **relativas** (comparten armadura).", keys: ["La3", "Si3", "Do4", "Re4", "Mi4", "Fa4", "Sol4", "La4"] },
      { t: "La **armónica** sube el séptimo grado (en La menor, **Sol#**): así el acorde de dominante es mayor y tira con fuerza hacia la tónica. La **melódica** sube además el sexto al subir, para que la melodía fluya.", keys: ["La3", "Si3", "Do4", "Re4", "Mi4", "Fa4", "Sol#4", "La4"] },
      { p: { kind: "ejercicio", id: "escala-menor", key: "La menor", hands: "rh" }, title: "Las tres menores en La" },
      { p: { kind: "obra", id: 76, level: 5 }, title: "Minueto en Sol menor (BWV Anh. 115)" },
      { p: { kind: "obra", id: 1612, level: 5 }, title: "Minueto en La menor" },
    ],
  },
  {
    id: "funciones", stage: 8, area: "Armonía", title: "Tónica, subdominante y dominante", summary: "Para qué sirve cada acorde: casa, salida y tensión.",
    requires: ["triadas", "escala-mayor"],
    related: ["progresiones-pop"],
    steps: [
      { t: "Sobre cada grado de la escala hay un acorde, y se numeran en romanos: **I ii iii IV V vi vii°** (mayúscula mayor, minúscula menor). En Do: Do, Rem, Mim, Fa, Sol, Lam, Si°." },
      { t: "Tienen funciones: la **tónica (I)** es casa, reposo. La **subdominante (IV)** es salir de casa. La **dominante (V)** es tensión que pide volver: por eso **V → I** suena a final.", keys: ["Sol3", "Si3", "Re4", "Fa4"], together: true },
      { t: "Las **cadencias** son los finales de frase: **auténtica** (V–I, cierre firme), **plagal** (IV–I, el «amén»), **rota** (V–vi, la sorpresa)." },
      { p: { kind: "ejercicio", id: "triadas-tonalidad", key: "Do", hands: "rh" }, title: "Las siete tríadas de Do" },
      { p: { kind: "ejercicio", id: "cadencias", key: "Do" }, title: "Las tres cadencias" },
    ],
  },
  {
    id: "progresiones-pop", stage: 8, area: "Armonía", title: "Progresiones de la música popular", summary: "Los cuatro acordes de mil canciones, y el blues.",
    requires: ["funciones", "inversiones"],
    steps: [
      { t: "**I–V–vi–IV** (en Do: Do, Sol, Lam, Fa) y **I–vi–IV–V** están detrás de cientos de canciones pop. Con buen enlace de voces la mano casi no se mueve." },
      { p: { kind: "ejercicio", id: "progresion-enlazada", key: "Sol" }, title: "I–vi–IV–V en Sol" },
      { t: "El **blues** tiene una forma fija de 12 compases (I I I I – IV IV I I – V IV I I), con acordes de séptima. Y la **pentatónica** (5 notas, sin semitonos) es la escala para improvisar encima." },
      { p: { kind: "ejercicio", id: "blues", key: "Do" }, title: "Blues de doce compases" },
    ],
  },

  {
    id: "todas-menores", stage: 8, area: "Escalas", title: "Las tonalidades menores", summary: "Cada mayor tiene su relativa menor.",
    requires: ["escalas-menores", "todas-mayores"],
    steps: [
      { t: "Cada tonalidad mayor tiene una **relativa menor** con la misma armadura, que empieza **tres semitonos más abajo** (su sexto grado): Do mayor – La menor, Sol mayor – Mi menor, Fa mayor – Re menor… Se distinguen por la tónica y porque la menor usa el séptimo grado alto (armónica).", keys: ["Mi4", "Fa#4", "Sol4", "La4", "Si4", "Do5", "Re#5", "Mi5"] },
      { p: { kind: "ejercicio", id: "escala-menor", key: "Mi menor", hands: "rh" }, title: "Mi menor: natural, armónica y melódica" },
      { p: { kind: "ejercicio", id: "escala-menor", key: "Re menor", hands: "both" }, title: "Re menor, manos juntas" },
      { p: { kind: "ejercicio", id: "escalas-menores-todas", hands: "rh" }, title: "Las doce menores armónicas" },
    ],
  },
  {
    id: "blues-improvisacion", stage: 8, area: "Escalas", title: "Pentatónica y blues: a improvisar", summary: "Las escalas para inventar melodías.",
    requires: ["escala-mayor"],
    related: ["progresiones-pop"],
    steps: [
      { t: "La **pentatónica mayor** son 5 notas de la mayor sin los semitonos (sin el 4.º ni el 7.º grado): Do-Re-Mi-Sol-La. La **menor** (La-Do-Re-Mi-Sol) son las mismas notas desde su relativa. Sin semitonos, casi nada suena mal: ideales para improvisar.", keys: ["Do4", "Re4", "Mi4", "Sol4", "La4"] },
      { t: "La **escala de blues** es la pentatónica menor más la «**blue note**» (la quinta disminuida): en Do, Do-Mib-Fa-Fa#-Sol-Sib. Prueba a inventar frases cortas con ella mientras la izquierda hace el blues de doce compases.", keys: ["Do4", "Re#4", "Fa4", "Fa#4", "Sol4", "La#4", "Do5"] },
      { p: { kind: "ejercicio", id: "pentatonica", key: "Do" }, title: "Pentatónica mayor" },
      { p: { kind: "ejercicio", id: "pentatonica", key: "La menor" }, title: "Pentatónica menor" },
      { p: { kind: "ejercicio", id: "escala-blues", key: "Do" }, title: "Escala de blues" },
      { p: { kind: "ejercicio", id: "blues", key: "Do" }, title: "La base para improvisar: blues de doce compases" },
    ],
  },
  // ================================================================ 9 · Técnica
  {
    id: "arpegios", stage: 9, area: "Técnica", title: "Arpegios", summary: "El acorde nota a nota, por todo el teclado.",
    requires: ["triadas", "escala-mayor"],
    steps: [
      { t: "Un **arpegio** es un acorde tocado nota a nota. En una octava la mano no se mueve (1-2-3-5); en dos octavas el pulgar pasa por debajo como en las escalas, pero con saltos más grandes: muñeca suelta." },
      { p: { kind: "ejercicio", id: "arpegio-una-octava", key: "Do" }, title: "Arpegio de una octava" },
      { p: { kind: "ejercicio", id: "arpegio-dos-octavas", key: "Do" }, title: "Arpegio de dos octavas" },
      { p: { kind: "obra", id: 5, level: 5 }, title: "Preludio en Do de Bach: arpegios de principio a fin" },
    ],
  },
  {
    id: "escalas-rapidas", stage: 9, area: "Técnica", title: "Escalas con las dos manos", summary: "Coordinar los pasos del pulgar y ganar velocidad.",
    requires: ["escala-mayor", "manos-juntas"],
    steps: [
      { t: "Juntas, los pasos del pulgar de cada mano **no coinciden**: esa es la dificultad. Practica muy lento con espera, después sin espera, y sube el tempo de 10 en 10 cuando te salga limpio." },
      { p: { kind: "ejercicio", id: "escala-dos-octavas", key: "Do", hands: "both" }, title: "Dos octavas, manos juntas" },
      { p: { kind: "ejercicio", id: "escala-cuatro-octavas", key: "Sol", hands: "both" }, title: "Cuatro octavas en semicorcheas" },
      { p: { kind: "ejercicio", id: "cromatica", hands: "rh" }, title: "Escala cromática" },
    ],
  },
  {
    id: "pedal", stage: 9, area: "Técnica", title: "El pedal", summary: "Unir sonidos sin emborronar.",
    requires: ["manos-juntas"],
    related: ["expresion-romantica"],
    steps: [
      { t: "El pedal de la derecha (**pedal de resonancia**) deja sonar las cuerdas aunque sueltes las teclas. Se usa **pedal sincopado**: al cambiar de acorde, se levanta justo cuando bajas las nuevas teclas y se vuelve a pisar enseguida. Si no, se mezclan y emborronan." },
      { t: "Con el teclado del ordenador, la barra espaciadora hace de pedal. La Gymnopédie de Satie es ideal: acordes lentos que hay que unir con pedal, cambiándolo en cada compás." },
      { p: { kind: "obra", id: 37, level: 5 }, title: "Gymnopédie n.º 1 (Satie)" },
    ],
  },

  // ================================================================ 10 · Expresión y repertorio
  {
    id: "fraseo", stage: 10, area: "Expresión", title: "Fraseo y articulación", summary: "Legato, staccato y frases que respiran.",
    requires: ["dinamica"],
    steps: [
      { t: "**Legato**: notas unidas, sin hueco (una tecla no se suelta hasta que baja la siguiente). **Staccato** (un punto encima): cortas y separadas. Una melodía se toca como se canta: en **frases**, con una respiración al final de cada una." },
      { t: "Burgmüller escribió sus 25 estudios fáciles (op. 100) justo para esto: cada uno trabaja un carácter. «La candidez», cantabile y legato; «Arabesca», ágil y staccato." },
      { p: { kind: "obra", id: 202, level: 5 }, title: "La candidez (Burgmüller)" },
      { p: { kind: "obra", id: 203, level: 5 }, title: "Arabesca (Burgmüller)" },
      { p: { kind: "obra", id: 218, level: 5 }, title: "Pastoral (Burgmüller)" },
    ],
  },
  {
    id: "para-elisa", stage: 10, area: "Repertorio", title: "Para Elisa", summary: "La obra más famosa de Beethoven, paso a paso.",
    requires: ["escalas-menores", "pedal"],
    steps: [
      { t: "Está en **La menor**: el famoso Mi-Re#-Mi-Re#-Mi del principio rodea la dominante. La izquierda hace **arpegios** (La-Mi-La) que pasan la melodía de una mano a otra. Empieza por los niveles bajos y por la primera sección." },
      { p: { kind: "obra", id: 931, level: 3 }, title: "Para Elisa: nivel 3" },
      { p: { kind: "obra", id: 931, level: 5 }, title: "Para Elisa completa" },
    ],
  },
  {
    id: "sonatina", stage: 10, area: "Repertorio", title: "La sonatina clásica", summary: "Forma, contraste y el bajo Alberti.",
    requires: ["funciones", "arpegios"],
    steps: [
      { t: "La **sonatina** es una sonata pequeña: un primer tema, un segundo tema contrastante (en la dominante) y la vuelta del primero. Mozart y sus contemporáneos acompañaban con el **bajo Alberti**: el acorde repartido grave-agudo-medio-agudo." },
      { p: { kind: "ejercicio", id: "alberti", key: "Do" }, title: "Bajo Alberti" },
      { p: { kind: "obra", id: 232, level: 5 }, title: "Kuhlau: Sonatina op. 20 n.º 1" },
      { p: { kind: "obra", id: 998, level: 5 }, title: "Mozart: Sonata facile K. 545" },
    ],
  },
  {
    id: "expresion-romantica", stage: 10, area: "Expresión", title: "Expresión romántica", summary: "Cantar con el piano, el rubato.",
    requires: ["fraseo", "pedal"],
    steps: [
      { t: "En la música romántica la melodía **canta** por encima de un acompañamiento más suave: equilibra las manos. El **rubato** es estirar y recuperar el tempo con libertad para que la frase respire." },
      { p: { kind: "obra", id: 504, level: 5 }, title: "Ensueño (Träumerei) de Schumann" },
      { p: { kind: "obra", id: 468, level: 5 }, title: "Preludio en Mi menor de Chopin" },
      { p: { kind: "obra", id: 470, level: 5 }, title: "Preludio en La mayor de Chopin" },
    ],
  },

  // ================================================================ 11 · Armonía avanzada y polifonía
  {
    id: "septimas", stage: 11, area: "Armonía", title: "Acordes de séptima y ii–V–I", summary: "El color del jazz y de la armonía clásica.",
    requires: ["funciones", "inversiones"],
    steps: [
      { t: "Añadiendo otra tercera a la tríada sale el **acorde de séptima**. El de dominante (**V7**, en Do: Sol-Si-Re-Fa) tiene la máxima tensión: el Si quiere subir a Do y el Fa bajar a Mi.", keys: ["Sol3", "Si3", "Re4", "Fa4"], together: true },
      { t: "**ii–V–I** (Rem7, Sol7, Domaj7) es la progresión del jazz: enlazada, casi solo se mueve una nota cada vez." },
      { p: { kind: "ejercicio", id: "septimas", key: "Do", hands: "rh" }, title: "Las séptimas de la tonalidad" },
      { p: { kind: "ejercicio", id: "ii-V-I", key: "Do" }, title: "ii–V–I" },
      { p: { kind: "oido", quiz: "acordes" }, title: "De oído: mayor, menor, disminuido o aumentado" },
    ],
  },
  {
    id: "polifonia", stage: 11, area: "Repertorio", title: "Polifonía: las Invenciones de Bach", summary: "Dos melodías independientes a la vez.",
    requires: ["escalas-rapidas"],
    steps: [
      { t: "En la **polifonía** cada mano lleva su propia melodía, igual de importante. En las **Invenciones**, Bach presenta un motivo corto y lo hace pasar de una mano a la otra, imitándose. Aprende cada mano por separado hasta poder cantarla." },
      { p: { kind: "obra", id: 69, level: 5 }, title: "Preludio pequeño en Re menor (BWV 926)" },
      { p: { kind: "obra", id: 40, hands: "rh", level: 5 }, title: "Invención n.º 1: la derecha" },
      { p: { kind: "obra", id: 40, hands: "lh", level: 5 }, title: "Invención n.º 1: la izquierda" },
      { p: { kind: "obra", id: 40, level: 5 }, title: "Invención n.º 1 completa" },
    ],
  },
  {
    id: "polirritmia", stage: 11, area: "Ritmo", title: "Tresillos y polirritmia", summary: "Tres contra dos, y el disminuido.",
    requires: ["corcheas-silencios", "manos-juntas"],
    steps: [
      { t: "El **tresillo** mete tres notas en el sitio de dos. **Tres contra dos**: una mano toca tres por pulso y la otra dos, coincidiendo solo en el pulso. La Arabesca n.º 1 de Debussy está llena de ellos." },
      { p: { kind: "ejercicio", id: "tres-contra-dos", key: "Do" }, title: "Tres contra dos" },
      { p: { kind: "ejercicio", id: "disminuido", key: "Do" }, title: "Arpegio de séptima disminuida" },
    ],
  },

  {
    id: "modos", stage: 11, area: "Escalas", title: "Los modos", summary: "Siete escalas desde las mismas teclas blancas.",
    requires: ["todas-mayores", "escalas-menores"],
    related: ["colores"],
    steps: [
      { t: "Toca las teclas blancas empezando en otra nota y sale otra escala: un **modo**. Desde Do, **jónico** (la mayor); desde Re, **dórico**; Mi, **frigio**; Fa, **lidio**; Sol, **mixolidio**; La, **eólico** (la menor natural); Si, **locrio**.", keys: ["Re4", "Mi4", "Fa4", "Sol4", "La4", "Si4", "Do5", "Re5"] },
      { t: "Cada uno tiene su color por la nota que lo distingue: **dórico** es menor con el 6.º alto (jazz, funk, folk); **frigio**, menor con el 2.º bajo (suena flamenco); **lidio**, mayor con el 4.º alto (soñador, cine); **mixolidio**, mayor con el 7.º bajo (rock, blues)." },
      { p: { kind: "ejercicio", id: "modo-dorico", key: "Re" }, title: "Re dórico" },
      { p: { kind: "ejercicio", id: "modo-frigio", key: "Mi" }, title: "Mi frigio" },
      { p: { kind: "ejercicio", id: "modo-lidio", key: "Fa" }, title: "Fa lidio" },
      { p: { kind: "ejercicio", id: "modo-mixolidio", key: "Sol" }, title: "Sol mixolidio" },
      { p: { kind: "ejercicio", id: "modo-dorico", key: "Do" }, title: "Do dórico (el mismo modo desde otra tónica)" },
      { p: { kind: "ejercicio", id: "modo-locrio", key: "Si" }, title: "Si locrio" },
    ],
  },
  {
    id: "colores", stage: 11, area: "Escalas", title: "Escalas de color: tonos enteros y cromática", summary: "Las escalas de Debussy y de los virtuosos.",
    requires: ["escala-mayor"],
    related: ["impresionismo"],
    steps: [
      { t: "La de **tonos enteros** son 6 notas a un tono cada una (Do-Re-Mi-Fa#-Sol#-La#): sin semitonos nada tira hacia ningún sitio, y suena a sueño. Solo hay dos distintas en todo el teclado.", keys: ["Do4", "Re4", "Mi4", "Fa#4", "Sol#4", "La#4", "Do5"] },
      { t: "La **cromática** usa las 12 teclas de semitono en semitono. Digitación: **3 en las negras, pulgar en las blancas**, y 1-2 en los pares de blancas (Mi-Fa, Si-Do)." },
      { p: { kind: "ejercicio", id: "tonos-enteros", key: "Do" }, title: "Tonos enteros" },
      { p: { kind: "ejercicio", id: "cromatica", hands: "rh" }, title: "Cromática con la derecha" },
      { p: { kind: "ejercicio", id: "cromatica", hands: "lh" }, title: "Cromática con la izquierda" },
    ],
  },
  // ================================================================ 12 · Hacia el virtuosismo
  {
    id: "ragtime", stage: 12, area: "Repertorio", title: "Ragtime: Scott Joplin", summary: "Síncopa en la derecha, «stride» en la izquierda.",
    requires: ["acompanar", "escalas-rapidas"],
    steps: [
      { t: "La **síncopa** acentúa lo que cae fuera del pulso: es el sabor del ragtime. La izquierda salta entre un bajo grave y un acorde en medio (**stride**), como un reloj, mientras la derecha juega con el ritmo." },
      { p: { kind: "obra", id: 263, level: 4 }, title: "The Entertainer: nivel 4" },
      { p: { kind: "obra", id: 263, level: 5 }, title: "The Entertainer completo" },
      { p: { kind: "obra", id: 23, level: 5 }, title: "Maple Leaf Rag" },
    ],
  },
  {
    id: "chopin", stage: 12, area: "Repertorio", title: "Chopin: el nocturno y el vals", summary: "El piano romántico por excelencia.",
    requires: ["expresion-romantica"],
    steps: [
      { t: "En el **nocturno** la derecha canta adornos como una voz de ópera mientras la izquierda mece con arpegios amplios. Pedal en cada armonía y rubato en la melodía." },
      { p: { kind: "obra", id: 1590, level: 5 }, title: "Nocturno op. 9 n.º 2" },
      { p: { kind: "obra", id: 511, level: 5 }, title: "Vals en Si menor (op. 69 n.º 2)" },
      { p: { kind: "obra", id: 483, level: 5 }, title: "Vals del minuto" },
    ],
  },
  {
    id: "impresionismo", stage: 12, area: "Repertorio", title: "Debussy y el impresionismo", summary: "Color, resonancia y armonías nuevas.",
    requires: ["pedal", "polirritmia"],
    steps: [
      { t: "Debussy piensa el piano como colores: acordes que se dejan resonar, escalas de tonos enteros, tresillos contra corcheas. El pedal y la dinámica muy suave son tan importantes como las notas." },
      { p: { kind: "obra", id: 1777, level: 5 }, title: "Arabesca n.º 1" },
      { p: { kind: "obra", id: 1778, level: 5 }, title: "Claro de luna" },
    ],
  },
  {
    id: "gran-repertorio", stage: 12, area: "Repertorio", title: "Gran repertorio", summary: "Obras de concierto para cuando todo lo demás fluye.",
    requires: ["chopin", "polifonia"],
    steps: [
      { t: "Estas obras piden todo a la vez: técnica, lectura, memoria y expresión. Divídelas en secciones, usa las zonas difíciles a tempo lento y no tengas prisa: los pianistas las trabajan durante meses." },
      { p: { kind: "obra", id: 108, level: 5 }, title: "Rondó alla turca (Mozart)" },
      { p: { kind: "obra", id: 295, level: 5 }, title: "Sonata Patética: Adagio cantabile (Beethoven)" },
      { p: { kind: "obra", id: 1693, level: 5 }, title: "Fantasía-Impromptu (Chopin)" },
      { p: { kind: "obra", id: 914, level: 5 }, title: "Estudio op. 10 n.º 1 (Chopin)" },
      { p: { kind: "obra", id: 1959, level: 5 }, title: "Balada n.º 1 (Chopin)" },
    ],
  },
];

const TONICS: Record<string, number> = { Do: 0, "Do#": 1, Reb: 1, Re: 2, Mib: 3, Mi: 4, Fa: 5, "Fa#": 6, Sol: 7, Lab: 8, La: 9, Sib: 10, Si: 11 };
/** «Sol», «La menor» → tonalidad. */
export function keyOf(name = "Do") {
  const [t, mode] = name.split(" ");
  if (!(t in TONICS)) throw new Error(`tonalidad que no se entiende: ${name}`);
  return { tonic: TONICS[t], minor: mode === "menor" };
}

/** Estrellas de una práctica según su mejor resultado (0-1): 1 desde el 70 %, 2 desde el 85 %, 3 desde el 95 %. */
export const stars = (acc?: number) => (acc == null ? 0 : acc >= 0.95 ? 3 : acc >= 0.85 ? 2 : acc >= 0.7 ? 1 : 0);
export const practiceSteps = (l: Lesson) => l.steps.map((s, i) => [s, i] as const).filter(([s]) => "p" in s) as [Extract<Step, { p: Practice }>, number][];
