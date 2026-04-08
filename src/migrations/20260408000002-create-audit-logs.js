'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('audit_logs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      tenantId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        field: 'tenantId',
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        field: 'userId',
      },
      action: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      category: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'general',
      },
      targetType: {
        type: Sequelize.STRING(50),
        allowNull: true,
        field: 'targetType',
      },
      targetId: {
        type: Sequelize.STRING(100),
        allowNull: true,
        field: 'targetId',
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      ipAddress: {
        type: Sequelize.STRING(45),
        allowNull: true,
        field: 'ipAddress',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    await queryInterface.addIndex('audit_logs', ['tenantId', 'createdAt']);
    await queryInterface.addIndex('audit_logs', ['tenantId', 'action']);
    await queryInterface.addIndex('audit_logs', ['userId']);

    // Add RLS policy for audit_logs (consistent with other tables)
    await queryInterface.sequelize.query(`
      ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'tenant_isolation_audit_logs') THEN
          EXECUTE 'CREATE POLICY tenant_isolation_audit_logs ON audit_logs
            USING ("tenantId" = current_setting(''app.current_tenant_id'', true)::integer)';
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_logs');
  },
};
