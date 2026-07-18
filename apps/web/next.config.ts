import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  env: { API_BASE: process.env.API_BASE ?? "http://localhost:8787" },
};

export default withNextIntl(config);
