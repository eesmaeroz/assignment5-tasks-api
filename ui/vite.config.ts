// Meryem Esma Eröz, 2200005798
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The UI calls /auth and /api on its own address; Vite forwards them to your API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:8000",
      "/api": "http://localhost:8000",
      // Bonus 13 (my change): forward the WebSocket too.
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
