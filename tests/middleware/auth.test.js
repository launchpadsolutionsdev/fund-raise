const { ensureAuth, ensureUploader, ensureAdmin } = require('../../src/middleware/auth');

function mockReq(overrides = {}) {
  return {
    isAuthenticated: jest.fn().mockReturnValue(false),
    xhr: false,
    headers: { accept: 'text/html' },
    originalUrl: '/test',
    path: '/test',
    session: {},
    user: {
      isAdmin: jest.fn().mockReturnValue(false),
      canUpload: jest.fn().mockReturnValue(false),
    },
    flash: jest.fn(),
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn();
  return res;
}

// ── ensureAuth ──────────────────────────────────────────────────────────────

describe('ensureAuth', () => {
  it('calls next() when user is authenticated', () => {
    const req = mockReq({ isAuthenticated: jest.fn().mockReturnValue(true) });
    const res = mockRes();
    const next = jest.fn();

    ensureAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated HTML request to /auth/login', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    ensureAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/auth/login');
  });

  it('returns 401 JSON for unauthenticated AJAX request (xhr: true)', () => {
    const req = mockReq({ xhr: true });
    const res = mockRes();
    const next = jest.fn();

    ensureAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session expired. Please log in again.' });
  });

  it('returns 401 JSON for unauthenticated request with JSON accept header', () => {
    const req = mockReq({ headers: { accept: 'application/json' } });
    const res = mockRes();
    const next = jest.fn();

    ensureAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session expired. Please log in again.' });
  });

  it('sets req.session.returnTo on redirect', () => {
    const req = mockReq({ originalUrl: '/dashboard?date=2025-01-01' });
    const res = mockRes();
    const next = jest.fn();

    ensureAuth(req, res, next);

    expect(req.session.returnTo).toBe('/dashboard?date=2025-01-01');
    expect(res.redirect).toHaveBeenCalledWith('/auth/login');
  });
});

// ── ensureUploader ──────────────────────────────────────────────────────────

describe('ensureUploader', () => {
  it('calls next() for authenticated admin (admins can upload)', () => {
    const req = mockReq({
      isAuthenticated: jest.fn().mockReturnValue(true),
      user: {
        isAdmin: jest.fn().mockReturnValue(true),
        canUpload: jest.fn().mockReturnValue(true),
      },
    });
    const res = mockRes();
    const next = jest.fn();

    ensureUploader(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('calls next() for authenticated uploader', () => {
    const req = mockReq({
      isAuthenticated: jest.fn().mockReturnValue(true),
      user: {
        isAdmin: jest.fn().mockReturnValue(false),
        canUpload: jest.fn().mockReturnValue(true),
      },
    });
    const res = mockRes();
    const next = jest.fn();

    ensureUploader(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('redirects authenticated viewer with flash error', () => {
    const req = mockReq({
      isAuthenticated: jest.fn().mockReturnValue(true),
      user: {
        isAdmin: jest.fn().mockReturnValue(false),
        canUpload: jest.fn().mockReturnValue(false),
      },
    });
    const res = mockRes();
    const next = jest.fn();

    ensureUploader(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(req.flash).toHaveBeenCalledWith('danger', 'You do not have permission to upload data.');
    expect(res.redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('redirects unauthenticated user to dashboard with flash', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    ensureUploader(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/dashboard');
  });
});

// ── ensureAdmin ─────────────────────────────────────────────────────────────

describe('ensureAdmin', () => {
  it('calls next() for authenticated admin', () => {
    const req = mockReq({
      isAuthenticated: jest.fn().mockReturnValue(true),
      user: {
        isAdmin: jest.fn().mockReturnValue(true),
        canUpload: jest.fn().mockReturnValue(false),
      },
    });
    const res = mockRes();
    const next = jest.fn();

    ensureAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('redirects authenticated non-admin with flash error', () => {
    const req = mockReq({
      isAuthenticated: jest.fn().mockReturnValue(true),
      user: {
        isAdmin: jest.fn().mockReturnValue(false),
        canUpload: jest.fn().mockReturnValue(false),
      },
    });
    const res = mockRes();
    const next = jest.fn();

    ensureAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(req.flash).toHaveBeenCalledWith('danger', 'Admin access required.');
    expect(res.redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('redirects unauthenticated user to dashboard with flash', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    ensureAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/dashboard');
  });
});
