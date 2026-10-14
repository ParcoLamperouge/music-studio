<script lang="ts">
  import type { Snippet } from "svelte";

  // Panel flotante pegado a su disparador (fixed: no lo corta ningún overflow). Se cierra con Esc, al pulsar fuera,
  // al hacer scroll o al cambiar el tamaño. `trigger` recibe { open, toggle } para pintar su botón.
  let {
    open = $bindable(false),
    side = "bottom",
    align = "start",
    width,
    label,
    trigger,
    children,
  }: {
    open?: boolean;
    side?: "bottom" | "top" | "right";
    align?: "start" | "end";
    width?: number;
    label?: string;
    trigger: Snippet<[{ open: boolean; toggle: () => void }]>;
    children: Snippet;
  } = $props();

  let wrap: HTMLElement;
  let panel: HTMLElement | undefined = $state();
  let pos = $state({ left: 0, top: 0 });
  const toggle = () => (open = !open);

  $effect(() => {
    if (!open || !panel) return;
    const r = wrap.getBoundingClientRect(), p = panel.getBoundingClientRect(), gap = 6;
    let left = side === "right" ? r.right + gap : align === "end" ? r.right - p.width : r.left;
    let top = side === "right" ? r.top : side === "top" ? r.top - gap - p.height : r.bottom + gap;
    if (side === "bottom" && top + p.height > innerHeight - 8 && r.top - gap - p.height > 8) top = r.top - gap - p.height; // no cabe: arriba
    left = Math.max(8, Math.min(left, innerWidth - p.width - 8));
    top = Math.max(8, Math.min(top, innerHeight - p.height - 8));
    pos = { left, top };
    panel.querySelector<HTMLElement>("[data-autofocus], [role='menuitem']:not(:disabled)")?.focus();
  });

  $effect(() => {
    if (!open) return;
    const scrolled = (e: Event) => !panel?.contains(e.target as Node) && (open = false);
    addEventListener("scroll", scrolled, true);
    return () => removeEventListener("scroll", scrolled, true);
  });

  function outside(e: PointerEvent) {
    if (open && !wrap.contains(e.target as Node) && !panel?.contains(e.target as Node)) open = false;
  }
  function esc(e: KeyboardEvent) {
    if (open && e.key === "Escape") {
      open = false;
      wrap.querySelector<HTMLElement>("button")?.focus();
      e.stopPropagation();
    }
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={esc} onresize={() => (open = false)} />

<span class="pop-anchor" bind:this={wrap}>{@render trigger({ open, toggle })}</span>
{#if open}
  <div
    class="popover"
    role="dialog"
    aria-label={label}
    bind:this={panel}
    style:left="{pos.left}px"
    style:top="{pos.top}px"
    style:width={width ? `${width}px` : undefined}
  >
    {@render children()}
  </div>
{/if}

<style>
  .pop-anchor { display: inline-flex; min-width: 0; }
  .popover {
    position: fixed; z-index: 120; min-width: 200px; max-height: calc(100vh - 16px); overflow-y: auto; padding: var(--s1);
    border-radius: var(--r-lg); background: var(--panel); box-shadow: var(--shadow); animation: rise var(--t-fast) var(--ease);
  }
</style>
