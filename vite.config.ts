import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  let privileged = key.startsWith("sb_secret_");
  if (key.startsWith("eyJ")) {
    try {
      privileged ||=
        JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
          .role === "service_role";
    } catch {
      /* Validación final a cargo del proveedor. */
    }
  }
  if (privileged)
    throw new Error(
      "Se detectó una clave privada en la configuración del navegador. Usa exclusivamente la clave publicable de Supabase.",
    );
  return {};
});
