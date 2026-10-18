import dotenv from "dotenv";

dotenv.config();
process.env.OMNI_API_ONLY = process.env.OMNI_API_ONLY || "true";

const { startServer } = await import("../../../server");

await startServer();
