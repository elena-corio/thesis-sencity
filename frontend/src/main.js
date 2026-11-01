import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles/style.css'
import App from './App.vue'
import router from './router.js'

createApp(App).use(createPinia()).use(router).mount('#app')
