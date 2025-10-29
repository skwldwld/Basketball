import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: '/Basketball/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        game: resolve(__dirname, 'game.html')
      }
    },
    assetsInlineLimit: 0,
    copyPublicDir: true
  },
  publicDir: 'src/models',
  resolve: {
    alias: {
      '@models': resolve(__dirname, 'src/models')
    }
  }
})