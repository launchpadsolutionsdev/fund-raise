#!/usr/bin/env node

/**
 * Bootstrap Sequelize Migrations
 *
 * If the database already has tables (created by sequelize.sync) but no
 * SequelizeMeta table, this script creates the meta table and marks all
 * existing migrations as "already run" so that `npx sequelize-cli db:migrate`
 * only runs NEW migrations.
 *
 * Safe to run repeatedly — it's a no-op if SequelizeMeta already exists
 * and contains entries.
 *
 * Usage: node scripts/bootstrap-migrations.js
 */

const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'src', 'migrations');

async function bootstrap() {
  let dbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/foundation_dashboard';
  if (dbUrl.startsWith('postgres://')) {
    dbUrl = dbUrl.replace('postgres://', 'postgresql://');
  }

  const opts = {
    dialect: 'postgres',
    logging: false,
  };
  if (process.env.NODE_ENV === 'production') {
    opts.dialectOptions = { ssl: { require: true, rejectUnauthorized: false } };
  }

  const sequelize = new Sequelize(dbUrl, opts);

  try {
    await sequelize.authenticate();

    // Check if SequelizeMeta already exists
    const [tables] = await sequelize.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'SequelizeMeta'`
    );

    if (tables.length > 0) {
      // Check if it has entries
      const [rows] = await sequelize.query(`SELECT COUNT(*) as cnt FROM "SequelizeMeta"`);
      if (Number(rows[0].cnt) > 0) {
        console.log('[Bootstrap] SequelizeMeta exists with entries — nothing to do.');
        await sequelize.close();
        return;
      }
    }

    // Check if the database has existing tables (i.e., was set up via sequelize.sync)
    const [existingTables] = await sequelize.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users'`
    );

    if (existingTables.length === 0) {
      console.log('[Bootstrap] Fresh database — migrations will create tables. Nothing to bootstrap.');
      await sequelize.close();
      return;
    }

    // Database has tables but no migration tracking — bootstrap SequelizeMeta
    console.log('[Bootstrap] Existing database detected without migration tracking. Bootstrapping...');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "SequelizeMeta" (
        name VARCHAR(255) NOT NULL UNIQUE PRIMARY KEY
      )
    `);

    // Mark all existing migration files as already run
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.js') && !f.startsWith('.'))
      .sort();

    for (const file of migrationFiles) {
      await sequelize.query(
        `INSERT INTO "SequelizeMeta" (name) VALUES (:name) ON CONFLICT DO NOTHING`,
        { replacements: { name: file } }
      );
      console.log(`  Marked as run: ${file}`);
    }

    console.log(`[Bootstrap] Done — ${migrationFiles.length} existing migrations marked as run.`);
    await sequelize.close();
  } catch (err) {
    console.error('[Bootstrap] Error:', err.message);
    await sequelize.close();
    process.exit(1);
  }
}

bootstrap();
