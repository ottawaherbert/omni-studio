import dotenv from "dotenv";

dotenv.config();

const { startServer } = await import("./server");

await startServer();
