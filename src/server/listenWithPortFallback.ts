import type { Express } from "express";
import type { Server } from "node:http";

export const listenWithPortFallback = (
  app: Express,
  startPort: number,
  host: string,
  apiOnly: boolean,
): Promise<Server> => new Promise((resolve, reject) => {
  const listen = (port: number) => {
    const server = app.listen(port, host);
    server.timeout = 20 * 60 * 1000;
    server.requestTimeout = 20 * 60 * 1000;
    server.keepAliveTimeout = 120 * 1000;
    server.headersTimeout = 125 * 1000;
    const handleListening = () => {
      server.off("error", handleStartupError);
      const displayHost = host.includes(":") ? `[${host}]` : host;
      console.log(`Server running on http://${displayHost}:${port}${apiOnly ? " (API only)" : ""}`);
      resolve(server);
    };
    const handleStartupError = (err: NodeJS.ErrnoException) => {
      server.off("listening", handleListening);
      if (err.code === "EADDRINUSE" && process.env.NODE_ENV !== "production") {
        console.warn(`Port ${port} is already in use, trying port ${port + 1}...`);
        listen(port + 1);
        return;
      }
      reject(err);
    };
    server.once("listening", handleListening);
    server.once("error", handleStartupError);
  };
  listen(startPort);
});
