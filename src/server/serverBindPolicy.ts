const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const resolveServerBindHost = (env: NodeJS.ProcessEnv = process.env) => {
  const host = (env.OMNI_HOST || "127.0.0.1").trim() || "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host.toLowerCase()) && env.OMNI_ALLOW_REMOTE_ACCESS !== "true") {
    throw new Error(
      "Refusing to expose project data and provider credentials remotely. Set OMNI_ALLOW_REMOTE_ACCESS=true only behind trusted access controls.",
    );
  }
  return host;
};
