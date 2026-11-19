import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => ({
  plugins: [
    {
      name: "local-api",
      configureServer(server) {
        Object.assign(
          process.env,
          loadEnv(mode, process.cwd(), ["AHOLO_", "BLOB_"]),
        );
        server.middlewares.use(async (req, res, next) => {
          const path = req.url?.split("?")[0];
          if (path === "/api/scan") {
            const { handleScan } = await import("./server/scan-service.mjs");
            await handleScan(req, res);
            return;
          }
          if (path !== "/api/plant" && path !== "/api/plant-status")
            return next();
          try {
            const { handle } = await import("./server/plant-service.mjs");
            await handle(req, res, path);
          } catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "Local request failed." }));
          }
        });
      },
    },
  ],
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  build: { chunkSizeWarningLimit: 1800 },
}));
