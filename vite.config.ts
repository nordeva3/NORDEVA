import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: { port: 3000 },
  // Production runs behind the host's proxy (e.g. Render): the public
  // hostname must be allowed or Vite answers "Blocked request".
  preview: { allowedHosts: ["nordeva.onrender.com", ".onrender.com"] },
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
