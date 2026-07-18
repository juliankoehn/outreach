import type { NextConfig } from "next";
const config: NextConfig = { env: { API_BASE: process.env.API_BASE ?? "http://localhost:8787" } };
export default config;
