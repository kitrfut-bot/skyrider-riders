import { defineConfig } from 'vite'

export default defineConfig({
  // relative asset paths so the build also works from the Android APK assets folder
  base: './',
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: ['.v0.build', 'localhost'],
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
})
