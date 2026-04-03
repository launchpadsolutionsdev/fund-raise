/**
 * Seed script: create initial tenant and admin user.
 * Usage: node src/seed.js --email admin@example.com [--name "Admin"]
 */
require('dotenv').config();
const { sequelize, Tenant, User } = require('./models');

async function seed() {
  const args = process.argv.slice(2);
  let email = null;
  let name = 'Admin';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) email = args[++i];
    if (args[i] === '--name' && args[i + 1]) name = args[++i];
  }

  if (!email) {
    console.error('Usage: node src/seed.js --email admin@example.com [--name "Admin"]');
    process.exit(1);
  }

  await sequelize.sync();

  let tenant = await Tenant.findOne({ where: { slug: 'tbrhsf' } });
  if (!tenant) {
    tenant = await Tenant.create({ name: 'Thunder Bay Regional HSF', slug: 'tbrhsf' });
    console.log('Created tenant:', tenant.name);
  } else {
    console.log('Tenant exists:', tenant.name);
  }

  let user = await User.findOne({ where: { email } });
  if (!user) {
    user = await User.create({ tenantId: tenant.id, email, name, role: 'admin' });
    console.log('Created admin user:', user.email);
  } else {
    console.log('User exists:', user.email);
  }

  await sequelize.close();
}

seed().catch(err => { console.error(err); process.exit(1); });
