<script>
  import { goto } from '$app/navigation';
</script>

<h1>Home</h1>
<button on:click={() => goto('/blog/hello')}>Read</button>
