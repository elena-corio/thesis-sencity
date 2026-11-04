import { createRouter, createWebHistory } from 'vue-router'
import MapView from './views/MapView.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/area' },
    { path: '/area', name: 'area', component: MapView },
    { path: '/:pathMatch(.*)*', redirect: '/area' },
  ],
})
