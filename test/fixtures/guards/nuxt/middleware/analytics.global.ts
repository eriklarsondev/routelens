export default defineNuxtRouteMiddleware((to) => {
  track(to.fullPath);
});
