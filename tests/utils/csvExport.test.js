describe('CSV escaping', () => {
  // Replicate the esc2 function used across CRM pages
  const esc2 = v => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return s.includes(',') || s.includes('"') ? '"' + s + '"' : s;
  };

  it('should escape values containing commas', () => {
    expect(esc2('hello, world')).toBe('"hello, world"');
  });

  it('should escape values containing quotes', () => {
    expect(esc2('say "hi"')).toBe('"say ""hi"""');
  });

  it('should handle null values', () => {
    expect(esc2(null)).toBe('');
  });

  it('should handle undefined values', () => {
    expect(esc2(undefined)).toBe('');
  });

  it('should pass through simple values', () => {
    expect(esc2('hello')).toBe('hello');
  });

  it('should convert numbers to strings', () => {
    expect(esc2(42)).toBe('42');
  });

  it('should handle empty string', () => {
    expect(esc2('')).toBe('');
  });

  it('should handle values with both commas and quotes', () => {
    expect(esc2('"amount: $1,000"')).toBe('"""amount: $1,000"""');
  });
});
