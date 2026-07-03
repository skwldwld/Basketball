import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/Basketball/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        game: resolve(__dirname, "game.html"),
        result: resolve(__dirname, "result.html"),
      },
    },
  },
});