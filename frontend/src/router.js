import { createRouter, createWebHistory } from 'vue-router'
import MapView from './views/MapView.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/area' },
    // Area, Routes and Profile are one view around one map, so the map stays when the tab changes.
    { path: '/:mode(area|routes|profile)', name: 'map', component: MapView },
    { path: '/:pathMatch(.*)*', redirect: '/area' },
  ],
})
