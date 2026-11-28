import { createRouter, createWebHistory } from 'vue-router'
import MapView from './views/MapView.vue'
import { AUTH_ON, isSignedIn, ready } from './lib/auth.js'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/area' },
    // Before sign-in (Elena, 2026-11-22): the welcome page with the privacy notice, then Clerk's sign-in or sign-up.
    { path: '/welcome', name: 'welcome', component: () => import('./views/WelcomeView.vue'), meta: { public: true } },
    { path: '/sign-in/:rest(.*)*', name: 'sign-in', component: () => import('./views/SignInView.vue'), meta: { public: true } },
    // Area, Routes and Profile are one view around one map, so the map stays when the tab changes.
    { path: '/:mode(area|routes|profile)', name: 'map', component: MapView },
    // The in-app test (D197): optional, after the profile; its own page with its own opt-in.
    { path: '/app-test', name: 'app-test', component: () => import('./views/AppTestView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/area' },
  ],
})

// Every page but the welcome and sign-in pages needs a signed-in user (the server checks every call too).
router.beforeEach(async (to) => {
  if (!AUTH_ON || to.meta.public) return true
  await ready()
  return isSignedIn() ? true : { name: 'welcome' }
})

export default router
