process.env.DATABASE_URL ??= "postgresql://outreach:outreach@localhost:5544/outreach";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:8787";
process.env.WEB_ORIGIN ??= "http://localhost:3000";
process.env.LINKEDIN_CLIENT_ID ??= "cid";
process.env.LINKEDIN_CLIENT_SECRET ??= "csecret";
process.env.LINKEDIN_REDIRECT_URI ??= "http://localhost:8787/linkedin/callback";
