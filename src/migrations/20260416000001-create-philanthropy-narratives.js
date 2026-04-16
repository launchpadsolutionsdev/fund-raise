'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('philanthropy_narratives', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      tenant_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      department: {
        type: Sequelize.STRING(40),
        allowNull: false,
      },
      fiscal_year: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      highlights: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      priorities: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      commentary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('philanthropy_narratives', ['tenant_id', 'department', 'fiscal_year'], {
      name: 'philanthropy_narratives_tenant_dept_fy_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('philanthropy_narratives');
  },
};
