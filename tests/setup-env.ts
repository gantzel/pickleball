(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://pbk:pbk_dev@localhost:5432/pbk_test";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123";
process.env.APP_URL = "http://localhost:3000";
process.env.DUPR_PROVIDER = "mock";
process.env.DUPR_WEBHOOK_SECRET = "test-webhook-secret";
process.env.CRON_SECRET = "test-cron-secret";
process.env.UPLOAD_DIR = "./storage/test-avatars";
