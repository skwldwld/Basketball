import { defineConfig } from 'vite'

export default defineConfig({
  base: '/Basketball/',
  build: {
    rollupOptions: {
      input: {
        main: '/Users/yeji/Desktop/4-1/CG/Basketball/index.html',
        game: '/Users/yeji/Desktop/4-1/CG/Basketball/game.html'
      }
    }
  }
})