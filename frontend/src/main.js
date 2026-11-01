import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles/style.css'
import App from './App.vue'
import router from './router.js'

// Remember whether the last input was the keyboard or a pointer (for focus outlines on text fields).
const setInput = (kind) => { document.documentElement.dataset.input = kind }
window.addEventListener('keydown', (e) => { if (e.key === 'Tab') setInput('keyboard') }, true)
window.addEventListener('pointerdown', () => setInput('pointer'), true)

createApp(App).use(createPinia()).use(router).mount('#app')
