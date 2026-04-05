describe('Tenant Model', () => {
  it('should define the model with correct table name and fields', () => {
    const mockDefine = jest.fn().mockReturnValue({});
    const defineTenant = require('../../src/models/tenant');
    defineTenant({ define: mockDefine });

    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine).toHaveBeenCalledWith(
      'Tenant',
      expect.objectContaining({
        id: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        name: expect.objectContaining({ allowNull: false }),
        slug: expect.objectContaining({ unique: true, allowNull: false }),
        logoPath: expect.objectContaining({ field: 'logo_path' }),
        missionStatement: expect.objectContaining({ field: 'mission_statement' }),
        addressLine1: expect.objectContaining({ field: 'address_line1' }),
        addressLine2: expect.objectContaining({ field: 'address_line2' }),
        city: expect.any(Object),
        state: expect.any(Object),
        zip: expect.any(Object),
        phone: expect.any(Object),
        website: expect.any(Object),
        ein: expect.any(Object),
        fiscalYearStart: expect.objectContaining({ defaultValue: 4, field: 'fiscal_year_start' }),
      }),
      expect.objectContaining({
        tableName: 'tenants',
        timestamps: true,
        updatedAt: false,
      })
    );
  });

  it('should return the result of sequelize.define', () => {
    const mockModel = { name: 'Tenant' };
    const mockDefine = jest.fn().mockReturnValue(mockModel);
    const defineTenant = require('../../src/models/tenant');
    const result = defineTenant({ define: mockDefine });

    expect(result).toBe(mockModel);
  });
});
