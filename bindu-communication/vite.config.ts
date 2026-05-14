import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"~": path.resolve(here, "src"),
		},
	},
	server: {
		port: 5174,
		host: "127.0.0.1",
		proxy: {
			"/api": "http://127.0.0.1:3787",
		},
	},
});
