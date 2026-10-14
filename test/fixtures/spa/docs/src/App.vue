<script setup lang="ts">
defineProps<{ section: string }>();
</script>

<template>
  <nav>
    <router-link to="/guide">Guide</router-link>
    <router-link :to="'/guide/' + section">This section</router-link>
    <router-link to="/gone">A page that was removed</router-link>
  </nav>
</template>
