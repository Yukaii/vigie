import { defineConfig } from 'kysely-ctl'; // Use defineConfig
import { PostgresDialect, type Dialect } from 'kysely';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';
import * as dotenv from 'dotenv';
// No longer need path or fileURLToPath for migration folder resolution

// Load environment variables from .env file if it exists
dotenv.config();

// Define the pool configuration
const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  // Add SSL configuration if required for your Supabase connection
  // ssl: {
  //   rejectUnauthorized: false, // Adjust as needed for your environment
  // },
  max: 10, // Kysely might require a max connection pool size
};

// Define the dialect using an async function for the pool
const dialect: Dialect = new PostgresDialect({
  pool: async () => new Pool(poolConfig) // Use async function to return the pool
});

// Export configuration using defineConfig and a relative path
export default defineConfig({
  dialect,
  migrations: {
    migrationFolder: 'src/migration', // Use relative path
  },
});
