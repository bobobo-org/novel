import type { Server } from "http";

export async function shutdownLocalRuntime(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
