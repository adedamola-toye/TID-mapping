import "dotenv/config";

// Tests always run against the dedicated test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://wakeel:wakeel_dev_pw@localhost:5432/wakeel_test";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "none";
process.env.DATA_ENCRYPTION_KEY ??= "WaYClU9wQse2Y+W7jF4wsUOblTRFTPXX01ELJ54mtng=";
process.env.DATA_HASH_KEY ??= "cT9b+X1DoMqVnhPONV8UWLNROCznPxWAVZPuHUzZPvQ=";
