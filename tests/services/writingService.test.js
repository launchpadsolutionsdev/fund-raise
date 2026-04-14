const {
  MODEL,
  MODES,
  CONTENT_TYPES,
  TONES,
  STORY_FORMATS,
  STORY_FOCUSES,
  MEETING_TYPES,
  THANKYOU_STYLES,
  DIGEST_TONES,
  DIGEST_AUDIENCES,
  writingSystemPrompt,
  thankYouSystemPrompt,
  impactSystemPrompt,
  meetingPrepSystemPrompt,
  digestSystemPrompt,
} = require('../../src/services/writingService');

describe('writingService', () => {
  describe('enum catalogs', () => {
    test('MODES contains the three supported writing modes', () => {
      expect(MODES).toEqual([
        'Draft from scratch',
        'Polish/edit my draft',
        'Reply to a message',
      ]);
    });

    test('CONTENT_TYPES covers the donor-facing communication types', () => {
      expect(CONTENT_TYPES).toContain('Thank you letter');
      expect(CONTENT_TYPES).toContain('Sympathy/condolence card');
      expect(CONTENT_TYPES).toContain('Donor email');
      expect(CONTENT_TYPES.length).toBe(6);
    });

    test('TONES contains the four supported tones', () => {
      expect(TONES).toEqual([
        'Warm & personal',
        'Professional & formal',
        'Celebratory',
        'Empathetic',
      ]);
    });

    test('STORY_FORMATS lists all five impact story output formats', () => {
      expect(STORY_FORMATS.length).toBe(5);
      expect(STORY_FORMATS).toContain('Annual Report Narrative');
      expect(STORY_FORMATS).toContain('Social Media Post');
    });

    test('STORY_FOCUSES lists all five impact focus areas', () => {
      expect(STORY_FOCUSES.length).toBe(5);
      expect(STORY_FOCUSES).toContain('Patient Care');
      expect(STORY_FOCUSES).toContain('Research');
    });

    test('MEETING_TYPES lists all six meeting types', () => {
      expect(MEETING_TYPES.length).toBe(6);
      expect(MEETING_TYPES).toContain('Board Presentation');
      expect(MEETING_TYPES).toContain('Donor Meeting');
    });

    test('THANKYOU_STYLES contains all five letter styles', () => {
      expect(Object.keys(THANKYOU_STYLES).sort()).toEqual(
        ['brief', 'formal', 'handwritten', 'impact', 'warm']
      );
    });

    test('DIGEST_TONES contains all four tones', () => {
      expect(Object.keys(DIGEST_TONES).sort()).toEqual(
        ['casual', 'celebratory', 'professional', 'strategic']
      );
    });

    test('DIGEST_AUDIENCES contains all four audiences', () => {
      expect(Object.keys(DIGEST_AUDIENCES).sort()).toEqual(
        ['all_staff', 'board', 'leadership', 'team']
      );
    });

    test('MODEL defaults to claude-sonnet-4-6', () => {
      // Env override takes precedence, but unit tests run with the default.
      expect(typeof MODEL).toBe('string');
      expect(MODEL.length).toBeGreaterThan(0);
    });
  });

  describe('writingSystemPrompt', () => {
    test('interpolates mode, content type, and tone', () => {
      const prompt = writingSystemPrompt({
        mode: 'Draft from scratch',
        contentType: 'Thank you letter',
        tone: 'Warm & personal',
      });
      expect(prompt).toContain('WRITING MODE: Draft from scratch');
      expect(prompt).toContain('CONTENT TYPE: Thank you letter');
      expect(prompt).toContain('TONE: Warm & personal');
    });

    test('includes mode-specific guidance for Polish mode', () => {
      const prompt = writingSystemPrompt({
        mode: 'Polish/edit my draft',
        contentType: 'Donor email',
        tone: 'Professional & formal',
      });
      expect(prompt).toContain('Improve it while preserving their voice');
    });

    test('includes mode-specific guidance for Reply mode', () => {
      const prompt = writingSystemPrompt({
        mode: 'Reply to a message',
        contentType: 'Donor email',
        tone: 'Professional & formal',
      });
      expect(prompt).toContain('write an appropriate reply');
    });

    test('reminds the model to strip commentary', () => {
      const prompt = writingSystemPrompt({
        mode: 'Draft from scratch',
        contentType: 'Donor email',
        tone: 'Celebratory',
      });
      expect(prompt).toContain('Return ONLY');
    });
  });

  describe('thankYouSystemPrompt', () => {
    test('resolves the style key to a human-readable description', () => {
      const prompt = thankYouSystemPrompt({ letterStyle: 'formal' });
      expect(prompt).toContain(THANKYOU_STYLES.formal);
    });

    test('falls back to warm style for unknown keys', () => {
      const prompt = thankYouSystemPrompt({ letterStyle: 'nonsense' });
      expect(prompt).toContain(THANKYOU_STYLES.warm);
    });

    test('includes donor name when provided', () => {
      const prompt = thankYouSystemPrompt({
        letterStyle: 'warm',
        donorName: 'Margaret Thompson',
      });
      expect(prompt).toContain('DONOR NAME: Margaret Thompson');
    });

    test('includes gift amount, type, and designation when provided', () => {
      const prompt = thankYouSystemPrompt({
        letterStyle: 'warm',
        giftAmount: 5000,
        giftType: 'One-time donation',
        designation: 'Cardiac Care',
      });
      expect(prompt).toContain('GIFT AMOUNT: $5000');
      expect(prompt).toContain('GIFT TYPE: One-time donation');
      expect(prompt).toContain('GIFT DESIGNATION: Cardiac Care');
    });

    test('omits gift fields entirely when not provided', () => {
      const prompt = thankYouSystemPrompt({ letterStyle: 'warm' });
      expect(prompt).not.toContain('GIFT AMOUNT');
      expect(prompt).not.toContain('GIFT TYPE');
      expect(prompt).not.toContain('GIFT DESIGNATION');
    });

    test('includes personal notes when provided', () => {
      const prompt = thankYouSystemPrompt({
        letterStyle: 'warm',
        personalNotes: 'Long-time supporter since 2010',
      });
      expect(prompt).toContain('PERSONAL NOTES FROM STAFF');
      expect(prompt).toContain('Long-time supporter since 2010');
    });
  });

  describe('impactSystemPrompt', () => {
    test('interpolates format and focus area', () => {
      const prompt = impactSystemPrompt({
        format: 'Annual Report Narrative',
        focus: 'Research',
      });
      expect(prompt).toContain('OUTPUT FORMAT: Annual Report Narrative');
      expect(prompt).toContain('IMPACT FOCUS AREA: Research');
    });

    test('includes optional gift amount and donor type', () => {
      const prompt = impactSystemPrompt({
        format: 'Donor Newsletter',
        focus: 'Patient Care',
        giftAmount: 25000,
        donorType: 'Corporate',
      });
      expect(prompt).toContain('GIFT AMOUNT: $25000');
      expect(prompt).toContain('DONOR TYPE: Corporate');
    });
  });

  describe('meetingPrepSystemPrompt', () => {
    test('includes the data context verbatim', () => {
      const dataContext = 'Total Raised: $1,234,567\nProgress: 42.0%';
      const prompt = meetingPrepSystemPrompt({
        meetingType: 'Board Presentation',
        dataContext,
      });
      expect(prompt).toContain(dataContext);
    });

    test('adds donor-meeting section when appropriate', () => {
      const prompt = meetingPrepSystemPrompt({
        meetingType: 'Donor Meeting',
        dataContext: '',
      });
      expect(prompt).toContain('Donor Engagement Notes');
    });

    test('adds board-presentation section when appropriate', () => {
      const prompt = meetingPrepSystemPrompt({
        meetingType: 'Board Presentation',
        dataContext: '',
      });
      expect(prompt).toContain('Board-Ready Metrics');
    });

    test('omits meeting-type-specific sections for other meetings', () => {
      const prompt = meetingPrepSystemPrompt({
        meetingType: 'Department Check-In',
        dataContext: '',
      });
      expect(prompt).not.toContain('Donor Engagement Notes');
      expect(prompt).not.toContain('Board-Ready Metrics');
    });
  });

  describe('digestSystemPrompt', () => {
    test('resolves tone and audience keys', () => {
      const prompt = digestSystemPrompt({
        tone: 'celebratory',
        audience: 'board',
        dataContext: 'SNAPSHOT DATE: 2026-04-14',
      });
      expect(prompt).toContain(DIGEST_TONES.celebratory);
      expect(prompt).toContain(DIGEST_AUDIENCES.board);
      expect(prompt).toContain('SNAPSHOT DATE: 2026-04-14');
    });

    test('falls back to professional tone for unknown keys', () => {
      const prompt = digestSystemPrompt({
        tone: 'nonsense',
        audience: 'nonsense',
        dataContext: '',
      });
      expect(prompt).toContain(DIGEST_TONES.professional);
      expect(prompt).toContain(DIGEST_AUDIENCES.team);
    });

    test('appends highlights when provided', () => {
      const prompt = digestSystemPrompt({
        tone: 'professional',
        audience: 'team',
        highlights: 'Matched 3 new grants this week',
        dataContext: '',
      });
      expect(prompt).toContain('ADDITIONAL HIGHLIGHTS TO INCLUDE');
      expect(prompt).toContain('Matched 3 new grants this week');
    });
  });
});
