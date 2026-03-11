import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,  // silence the warning, or:
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ["recharts"],  // split heavy libs into separate chunks
          react: ["react", "react-dom"],
        }
      }
    }
  },
  server: {
    proxy: {
      '/admin': 'http://localhost:8000',
      '/search': 'http://localhost:8000',
      '/prices': 'http://localhost:8000',
    }
  }
});
