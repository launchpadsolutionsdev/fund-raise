#!/usr/bin/env node
/**
 * One-time script to encrypt existing plaintext Blackbaud tokens.
 *
 * Usage:
 *   TOKEN_ENCRYPTION_KEY=<your-key> node scripts/encrypt-existing-tokens.js
 *
 * This script:
 *   1. Reads all blackbaud_tokens rows directly (bypassing model hooks)
 *   2. Checks if tokens are already encrypted (skips if so)
 *   3. Encrypts plaintext tokens and updates the row
 *
 * Safe to run multiple times — already-encrypted tokens are skipped.
 */
require('dotenv').config();

const { encrypt, isEncrypted } = require('../src/utils/tokenEncryption');

async function main() {
  // Validate key is set
  if (!process.env.TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY.length !== 64) {
    console.error('ERROR: TOKEN_ENCRYPTION_KEY must be set (64 hex chars). Generate with: openssl rand -hex 32');
    process.exit(1);
  }

  // Use raw Sequelize to bypass model hooks (which would double-encrypt)
  const { Sequelize } = require('sequelize');
  const dbConfig = require('../src/config/database');
  const env = process.env.NODE_ENV || 'development';
  const config = dbConfig[env] || dbConfig;

  const sequelize = config.use_env_variable
    ? new Sequelize(process.env[config.use_env_variable], config)
    : new Sequelize(config.database, config.username, config.password, config);

  try {
    await sequelize.authenticate();
    console.log('Connected to database.');

    const [tokens] = await sequelize.query('SELECT id, access_token, refresh_token FROM blackbaud_tokens');
    console.log(`Found ${tokens.length} token row(s).`);

    let encrypted = 0;
    let skipped = 0;

    for (const row of tokens) {
      const accessNeedsEncryption = row.access_token && !isEncrypted(row.access_token);
      const refreshNeedsEncryption = row.refresh_token && !isEncrypted(row.refresh_token);

      if (!accessNeedsEncryption && !refreshNeedsEncryption) {
        console.log(`  Row ${row.id}: already encrypted, skipping.`);
        skipped++;
        continue;
      }

      const newAccess = accessNeedsEncryption ? encrypt(row.access_token) : row.access_token;
      const newRefresh = refreshNeedsEncryption ? encrypt(row.refresh_token) : row.refresh_token;

      await sequelize.query(
        'UPDATE blackbaud_tokens SET access_token = $1, refresh_token = $2 WHERE id = $3',
        { bind: [newAccess, newRefresh, row.id] }
      );
      console.log(`  Row ${row.id}: encrypted successfully.`);
      encrypted++;
    }

    console.log(`\nDone. Encrypted: ${encrypted}, Skipped: ${skipped}`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
