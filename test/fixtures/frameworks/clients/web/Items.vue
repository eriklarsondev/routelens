<script setup lang="ts">
const { data } = await useFetch('/api/nuxt-items');

async function add() {
  await $fetch('/api/nuxt-items', { method: 'POST', body: {} });
}
</script>

<template>
  <button @click="add">{{ data }}</button>
</template>
