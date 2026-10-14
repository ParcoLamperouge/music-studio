<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  // Panel con borde. `pad`: relleno (none para contenido a sangre, como una portada); `selected`: borde de acento.
  let { pad = "md", selected = false, children, ...rest }: HTMLAttributes<HTMLDivElement> & {
    pad?: "none" | "sm" | "md";
    selected?: boolean;
    children: Snippet;
  } = $props();
</script>

<div class="panel p-{pad}" class:selected {...rest}>{@render children()}</div>

<style>
  .panel { min-width: 0; border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line); transition: border-color var(--t-fast); }
  .p-sm { padding: var(--s2) var(--s3); }
  .p-md { padding: var(--s3) var(--s4); }
  .p-none { overflow: hidden; }
  .selected { border-color: var(--accent-line); }
</style>
