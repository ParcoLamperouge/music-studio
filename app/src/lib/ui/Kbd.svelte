<script lang="ts">
  // Atajo de teclado: «Ctrl+K» → dos teclas.
  let { keys }: { keys: string } = $props();
</script>

<span class="kbd">{#each keys.split("+") as k, i (i)}<kbd>{k}</kbd>{/each}</span>

<style>
  .kbd { display: inline-flex; gap: 2px; flex-shrink: 0; }
</style>
