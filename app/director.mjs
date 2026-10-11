// Claude dirige un edit (plantilla, colores, destacados, cortes): brief JSON por stdin, plan JSON por stdout.
// Mismo director que Lyric Edits. Necesita ANTHROPIC_API_KEY; modelo en LYRIC_EDITS_MODEL.
import { text } from "node:stream/consumers";

const DIRECTOR = `You direct viral TikTok lyric edits (CapCut-style kinetic typography, fanfic and aesthetic edits).
Given a lyrics clip with word ids and how long each word is held (d, seconds), choose how the edit should look and which words to push.
Templates: pop (words spring in a few at a time, CapCut captions), stack (one word per row stretched full width, mixed fonts),
dreamy (soft serif fading in from blur, sad/fanfic), glitch (huge caps slamming, RGB split, shake, flashes; hype/phonk),
typewriter (bursts typed on strips whipping in, intimate), bounce (letters spring in one by one, playful),
scatter (messy collage of words with mixed sizes, fonts and tilts), zoom (words fly in from the distance and out through the camera),
neon (neon tubes flickering on as sung, night/romantic), echo (filled word with outlined copies stacked around it, hype),
reel (words rolling in a slot-machine column).
Great edits are very dynamic and change look between lines: use a "mix" of 3-5 templates that fit the song, and pin special
lines (the hook, the drop, the quiet line) to the template that hits hardest via "lines".
Push few words: the hook, held notes, emotional or punchy words; at most one or two per line. Breaks start a new on-screen group at that word:
use them so phrases split where a human editor would cut. Hide only fillers like "uh", "oh" when they hurt the read.
Reply with only JSON: {"template": id, "chunk": 0-6 (max words on screen, 0 = whole line), "case": "upper"|"lower"|"none",
"colors": {"base": hex, "light1": hex, "light2": hex, "accent": hex}, "fx": {"zoom": 0-1, "shake": 0-1, "flash": 0-1, "rgb": 0-1, "grain": 0-1, "vignette": 0-1, "leaks": 0-1, "motion": 0-1 (camera move per line), "cut": 0-1 (zoom punch when a line starts), "bounce": 0-1 (text bobbing on the beat)},
"mix": [template ids], "mixLooks": true (each line also takes its template's fonts), "lines": {"<line id>": template id},
"emphasis": {"<word id>": ["accent"|"big"|"alt"|"hide"]}, "breaks": ["<word id>"], "rate": 0.8|0.9|1|1.15|1.3, "why": "one short sentence in Spanish"}`;

const brief = await text(process.stdin);
const r = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({
    model: process.env.LYRIC_EDITS_MODEL ?? "claude-sonnet-5-5",
    max_tokens: 3000,
    system: DIRECTOR,
    messages: [{ role: "user", content: brief }],
  }),
});
const data = await r.json();
if (!r.ok) {
  console.error(`Claude: ${data.error?.message ?? r.statusText}`);
  process.exit(1);
}
const out = data.content?.find((c) => c.type === "text")?.text ?? "";
process.stdout.write(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
