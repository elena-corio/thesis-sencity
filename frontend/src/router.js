import { createRouter, createWebHistory } from 'vue-router'
import MapView from './views/MapView.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/map' },
    { path: '/map', name: 'map', component: MapView },
    { path: '/:pathMatch(.*)*', redirect: '/map' },
  ],
})
