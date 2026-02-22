import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@whiskeysockets/baileys", "pino"],
};

export default nextConfig;
