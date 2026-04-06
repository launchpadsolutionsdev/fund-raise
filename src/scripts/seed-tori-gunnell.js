/**
 * Seed script: Create tenant "Tori Gunnell" and admin user toringunnell12@gmail.com
 *
 * Run with:  node src/scripts/seed-tori-gunnell.js
 */
require('dotenv').config();

const { sequelize, Tenant, User, TenantDataConfig } = require('../models');

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');

    // Create tenant
    const [tenant, tenantCreated] = await Tenant.findOrCreate({
      where: { slug: 'tori-gunnell' },
      defaults: {
        name: 'Tori Gunnell',
        slug: 'tori-gunnell',
        fiscalYearStart: 4,
        onboardingCompleted: false,
        onboardingStep: 1,
      },
    });

    if (tenantCreated) {
      console.log(`Created tenant: "${tenant.name}" (id: ${tenant.id})`);
    } else {
      console.log(`Tenant already exists: "${tenant.name}" (id: ${tenant.id})`);
    }

    // Create user
    const [user, userCreated] = await User.findOrCreate({
      where: { email: 'toringunnell12@gmail.com' },
      defaults: {
        tenantId: tenant.id,
        email: 'toringunnell12@gmail.com',
        name: 'Tori Gunnell',
        role: 'admin',
        isActive: true,
      },
    });

    if (userCreated) {
      console.log(`Created user: ${user.email} (role: ${user.role}, tenant: ${tenant.name})`);
    } else {
      console.log(`User already exists: ${user.email} (role: ${user.role})`);
      // Ensure they're on the right tenant and role
      if (user.tenantId !== tenant.id || user.role !== 'admin') {
        await user.update({ tenantId: tenant.id, role: 'admin' });
        console.log('Updated user tenant/role.');
      }
    }

    // Create TenantDataConfig so data onboarding is ready
    const [dc, dcCreated] = await TenantDataConfig.findOrCreate({
      where: { tenantId: tenant.id },
      defaults: { tenantId: tenant.id },
    });

    if (dcCreated) {
      console.log('Created TenantDataConfig for data onboarding.');
    } else {
      console.log('TenantDataConfig already exists.');
    }

    console.log('\nDone! Tori can now log in with Google OAuth at toringunnell12@gmail.com');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
