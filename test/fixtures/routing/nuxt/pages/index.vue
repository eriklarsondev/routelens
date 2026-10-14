<script setup lang="ts">
async function lost() {
  await navigateTo('/missing');
}
</script>

<template>
  <NuxtLink to="/users/1">First user</NuxtLink>
  <button @click="lost">Lost</button>
</template>
