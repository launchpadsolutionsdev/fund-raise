const path = require('path');

// The knowledgeBaseRouter module uses fs.statSync and fs.readFileSync.
// We mock the entire fs module to control behavior.
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    statSync: jest.fn().mockReturnValue({ mtimeMs: 100 }),
    readFileSync: jest.fn().mockReturnValue('Sample KB content'),
  };
});

const fs = require('fs');
const mod = require('../../src/services/knowledgeBaseRouter');

describe('knowledgeBaseRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.statSync.mockReturnValue({ mtimeMs: 100 });
    fs.readFileSync.mockReturnValue('Sample KB content');
  });

  describe('loadKnowledgeBase', () => {
    it('loads content from file', () => {
      // Force new mtime to trigger reload
      fs.statSync.mockReturnValue({ mtimeMs: Date.now() });
      fs.readFileSync.mockReturnValue('KB file content');
      const result = mod.loadKnowledgeBase();
      expect(result).toBe('KB file content');
    });

    it('caches content on subsequent calls with same mtime', () => {
      const mtime = Date.now() + 1000;
      fs.statSync.mockReturnValue({ mtimeMs: mtime });
      fs.readFileSync.mockReturnValue('Cached content');
      mod.loadKnowledgeBase(); // first load

      fs.readFileSync.mockClear();
      const result = mod.loadKnowledgeBase(); // cached
      expect(result).toBe('Cached content');
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it('reloads when mtime changes', () => {
      fs.statSync.mockReturnValue({ mtimeMs: 5000 });
      fs.readFileSync.mockReturnValue('First version');
      mod.loadKnowledgeBase();

      fs.statSync.mockReturnValue({ mtimeMs: 6000 });
      fs.readFileSync.mockReturnValue('Second version');
      const result = mod.loadKnowledgeBase();
      expect(result).toBe('Second version');
    });

    it('returns cached content on file error', () => {
      // Load successfully first
      fs.statSync.mockReturnValue({ mtimeMs: 7000 });
      fs.readFileSync.mockReturnValue('Good content');
      mod.loadKnowledgeBase();

      // Now simulate error
      fs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const result = mod.loadKnowledgeBase();
      expect(result).toBe('Good content');
    });
  });

  describe('shouldInjectRENXTKnowledgeBase', () => {
    it('returns true for blackbaud keyword', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase('blackbaud question', null, false)).toBe(true);
    });

    it('returns true for raiser keyword', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase('Raisers Edge help', null, false)).toBe(true);
    });

    it('returns true for constituent keyword', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase('find a constituent', null, false)).toBe(true);
    });

    it('returns true for pledge keyword', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase('check pledge status', null, false)).toBe(true);
    });

    it('returns true for troubleshoot keyword', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase('troubleshoot error', null, false)).toBe(true);
    });

    it('returns true for "how do i" keyword', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase('how do i do this?', null, false)).toBe(true);
    });

    it('returns true when RE NXT session', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase('hello', { isRenxtSession: true }, false)).toBe(true);
    });

    it('returns true when image attached', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase('help', null, true)).toBe(true);
    });

    it('returns false for unrelated message', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase('how much raised last year?', null, false)).toBe(false);
    });

    it('returns false for null message', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase(null, null, false)).toBe(false);
    });

    it('is case insensitive', () => {
      expect(mod.shouldInjectRENXTKnowledgeBase('BLACKBAUD', null, false)).toBe(true);
    });
  });

  describe('getKnowledgeBaseInjection', () => {
    it('returns injection when keywords match', () => {
      fs.statSync.mockReturnValue({ mtimeMs: 8000 });
      fs.readFileSync.mockReturnValue('Real KB data');
      // Force reload
      mod.loadKnowledgeBase();

      const result = mod.getKnowledgeBaseInjection('blackbaud help', null, false);
      expect(result.inject).toBe(true);
      expect(result.knowledgeBaseText).toContain('[RE NXT KNOWLEDGE BASE]');
      expect(result.knowledgeBaseText).toContain('Real KB data');
    });

    it('returns no injection for unrelated message', () => {
      const result = mod.getKnowledgeBaseInjection('total raised this year', null, false);
      expect(result.inject).toBe(false);
      expect(result.knowledgeBaseText).toBe('');
    });

    it('returns injection for image messages', () => {
      const result = mod.getKnowledgeBaseInjection('help me', null, true);
      expect(result.inject).toBe(true);
    });
  });
});
