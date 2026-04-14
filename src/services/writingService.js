/**
 * Writing Service
 *
 * Shared infrastructure for all AI-powered writing features:
 *   - Writing Assistant   (/writing-assistant)
 *   - Thank-You Letters   (/thank-you-letters)
 *   - Impact Stories      (/impact-stories)
 *   - Meeting Prep        (/meeting-prep)
 *   - Weekly Digest       (/weekly-digest)
 *
 * Responsibilities:
 *   - Memoized Anthropic client
 *   - SSE streaming helper (identical behavior across all features)
 *   - Shared enum catalogs for input validation
 *   - Per-feature system prompt builders
 *
 * This module is intentionally thin: each route still owns its own data
 * fetching (e.g. snapshot lookups for Meeting Prep / Digest), validation,
 * and response wiring. The service concentrates the mechanics that were
 * previously copy-pasted across five route files.
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.AI_WRITING_MODEL || 'claude-sonnet-4-6';

let _client;
function getClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared enum catalogs
// ─────────────────────────────────────────────────────────────────────────────

const MODES = ['Draft from scratch', 'Polish/edit my draft', 'Reply to a message'];

const CONTENT_TYPES = [
  'Thank you letter',
  'Sympathy/condolence card',
  'Donor email',
  'Event invitation',
  'Follow-up email',
  'General correspondence',
];

const TONES = ['Warm & personal', 'Professional & formal', 'Celebratory', 'Empathetic'];

const STORY_FORMATS = [
  'Annual Report Narrative',
  'Social Media Post',
  'Donor Newsletter',
  'Website Feature',
  'Board Presentation Slide',
];

const STORY_FOCUSES = [
  'Patient Care',
  'Equipment & Technology',
  'Research',
  'Education & Training',
  'General Operations',
];

const MEETING_TYPES = [
  'Board Presentation',
  'Donor Meeting',
  'Department Check-In',
  'Campaign Strategy Session',
  'Year-End Review',
  'New Donor Cultivation',
];

const THANKYOU_STYLES = {
  formal: 'Formal and traditional — suitable for major donors and official correspondence',
  warm: 'Warm and personal — conversational yet professional',
  brief: 'Brief and sincere — a concise thank-you note (150-200 words)',
  impact: 'Impact-focused — emphasize what their gift will accomplish',
  handwritten: 'Handwritten card style — short, heartfelt, personal (100-150 words)',
};

const DIGEST_TONES = {
  professional: 'Professional and polished — suitable for senior leadership',
  casual: 'Warm and casual — suitable for internal team distribution',
  celebratory: 'Upbeat and celebratory — emphasize wins and momentum',
  strategic: 'Data-driven and strategic — focus on trends and next steps',
};

const DIGEST_AUDIENCES = {
  team: 'the internal fundraising team',
  leadership: 'senior leadership and executive team',
  board: 'the Board of Directors',
  all_staff: 'all Foundation staff',
};

// ─────────────────────────────────────────────────────────────────────────────
// System prompt builders
// ─────────────────────────────────────────────────────────────────────────────

function writingSystemPrompt({ mode, contentType, tone }) {
  return `You are a professional fundraising communications writer for a hospital foundation (Thunder Bay Regional Health Sciences Foundation). You specialize in crafting donor-facing communications that are thoughtful, genuine, and effective.

WRITING MODE: ${mode}
CONTENT TYPE: ${contentType}
TONE: ${tone}

Guidelines:
- Write in the voice of a foundation staff member, not a chatbot
- Be genuine and specific — avoid generic boilerplate
- For thank you letters: express heartfelt gratitude, mention the impact of the gift
- For sympathy/condolence cards: be empathetic and respectful, keep it brief and warm
- For donor emails: balance warmth with professionalism, include a clear purpose
- For event invitations: create excitement while maintaining dignity
- For follow-up emails: be timely and personal, reference previous interactions
- For general correspondence: match the context provided
- Use Canadian English spelling (honour, centre, programme, etc.)
- Keep the writing concise but complete
- Do not include placeholder brackets like [Name] unless the user hasn't provided specific details

${mode === 'Polish/edit my draft' ? 'The user will provide their draft. Improve it while preserving their voice and intent. Fix grammar, improve flow, and strengthen the message.' : ''}
${mode === 'Reply to a message' ? 'The user will provide the message they received. Write an appropriate reply that addresses the key points.' : ''}
${mode === 'Draft from scratch' ? 'The user will provide context/notes about what they want to communicate. Create a polished, ready-to-send piece.' : ''}

Return ONLY the written content — no commentary, no explanations, no "Here is..." preamble. Just the letter/email/card text itself.`;
}

function thankYouSystemPrompt({ donorName, giftAmount, giftType, designation, letterStyle, personalNotes }) {
  return `You are a donor relations specialist for the Thunder Bay Regional Health Sciences Foundation. You write heartfelt, personalized thank-you letters that make donors feel valued and connected to the impact of their gift.

LETTER STYLE: ${THANKYOU_STYLES[letterStyle] || THANKYOU_STYLES.warm}
${donorName ? `DONOR NAME: ${donorName}` : 'DONOR NAME: [The letter should work as a template with "Dear [Donor Name]"]'}
${giftAmount ? `GIFT AMOUNT: $${giftAmount}` : ''}
${giftType ? `GIFT TYPE: ${giftType}` : ''}
${designation ? `GIFT DESIGNATION: ${designation}` : ''}

Guidelines:
- Address the donor by name (or use a respectful greeting if no name provided)
- Acknowledge the specific gift amount and type if provided
- Connect the gift to tangible impact at Thunder Bay Regional Health Sciences Centre
- Express genuine gratitude — avoid sounding formulaic or automated
- Use Canadian English (honour, centre, programme, colour)
- Include a specific, vivid example of how their gift helps (even if illustrative)
- Close with an invitation to stay connected with the Foundation
- Sign off as appropriate for the style (e.g., "With gratitude," for formal)
- Do NOT include placeholder brackets in the final output — create complete content
- If no donor name is given, use "Dear Friend" or similar

${personalNotes ? `PERSONAL NOTES FROM STAFF:\n${personalNotes}` : ''}

Return ONLY the letter content — no meta-commentary or explanations.`;
}

function impactSystemPrompt({ format, focus, giftAmount, donorType }) {
  return `You are a storytelling expert for the Thunder Bay Regional Health Sciences Foundation. You craft compelling donor impact narratives that connect financial gifts to real-world outcomes.

OUTPUT FORMAT: ${format}
IMPACT FOCUS AREA: ${focus}
${giftAmount ? `GIFT AMOUNT: $${giftAmount}` : ''}
${donorType ? `DONOR TYPE: ${donorType}` : ''}

Guidelines:
- Write from the Foundation's perspective, showing the tangible impact of donations
- Use specific, vivid details that make the reader feel the impact (even if illustrative)
- For patient stories, use respectful, anonymized language ("a young mother", "a local firefighter")
- Connect the donor's generosity to real outcomes: equipment purchased, procedures enabled, lives touched
- Match the format: annual reports are formal/comprehensive, social media is punchy/emotional, newsletters are warm/personal
- For board presentations, use data-driven language with impact metrics
- Use Canadian English (honour, centre, programme)
- If the format is Social Media Post, keep it under 280 characters for Twitter-friendliness, or provide both a short and long version
- Do NOT use placeholder brackets — create a complete, realistic narrative
- Include a suggested headline/title at the start

Return ONLY the narrative content — no meta-commentary.`;
}

function meetingPrepSystemPrompt({ meetingType, attendees, agenda, department, duration, dataContext }) {
  return `You are a meeting preparation assistant for the Thunder Bay Regional Health Sciences Foundation. Generate a comprehensive briefing document for the upcoming meeting.

MEETING TYPE: ${meetingType}
${attendees ? `ATTENDEES: ${attendees}` : ''}
${agenda ? `AGENDA NOTES: ${agenda}` : ''}
${duration ? `DURATION: ${duration} minutes` : ''}
${department ? `FOCUS DEPARTMENT: ${department}` : ''}

CURRENT FUNDRAISING DATA:
${dataContext}

Generate a structured briefing document that includes:
1. **Meeting Overview** — purpose, attendees, suggested duration
2. **Key Talking Points** — 3-5 main points with supporting data from the snapshot
3. **Data Highlights** — relevant metrics, trends, and comparisons to present
4. **Discussion Questions** — thought-provoking questions to drive conversation
5. **Action Items Template** — suggested follow-up items based on meeting type
${meetingType === 'Donor Meeting' ? '6. **Donor Engagement Notes** — suggested conversation starters, gift ask range, stewardship opportunities' : ''}
${meetingType === 'Board Presentation' ? '6. **Board-Ready Metrics** — key numbers formatted for board consumption, suggested visuals' : ''}

Use Canadian English. Be specific with numbers from the data. Format with clear markdown headings.`;
}

function digestSystemPrompt({ tone, audience, highlights, dataContext }) {
  return `You are a communications specialist for the Thunder Bay Regional Health Sciences Foundation. Generate a weekly fundraising digest/summary report.

TONE: ${DIGEST_TONES[tone] || DIGEST_TONES.professional}
AUDIENCE: Written for ${DIGEST_AUDIENCES[audience] || DIGEST_AUDIENCES.team}

CURRENT DATA:
${dataContext}

${highlights ? `ADDITIONAL HIGHLIGHTS TO INCLUDE:\n${highlights}` : ''}

Guidelines:
- Start with a brief greeting/intro appropriate for the audience
- Include a "Numbers at a Glance" section with key metrics
- Highlight departmental progress — call out leaders and areas needing attention
- Include a "Wins This Week" section (derive from the data or highlights provided)
- End with a "Looking Ahead" section with 2-3 forward-looking items
- Use Canadian English (honour, centre, programme)
- Keep it concise but informative — aim for 300-500 words
- Format with clear sections using headings
- If data shows strong progress (>75%), be encouraging. If lagging (<50%), be motivating without being negative
- Do NOT use placeholder brackets — create complete, realistic content`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE streaming helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stream a Claude generation to an Express SSE response.
 *
 * Emits three event shapes on the wire:
 *   { text: "<chunk>" }                            // per text delta
 *   { done: true, fullText: "<complete output>" }  // on successful completion
 *   { error: "<message>" }                         // on mid-stream failure
 *
 * Pre-stream failures (e.g. missing API key) are returned as a 500 JSON body.
 *
 * @param {object} res - Express response (must not have sent headers yet)
 * @param {object} opts
 * @param {string} opts.feature       - Feature identifier, used for log tagging
 * @param {string} opts.systemPrompt  - System prompt for the model
 * @param {string} opts.userMessage   - User message content
 * @param {number} [opts.maxTokens=2048] - Max output tokens
 * @returns {Promise<{fullText:string, error?:Error}>}
 */
async function streamGeneration(res, { feature, systemPrompt, userMessage, maxTokens = 2048 }) {
  let client;
  try {
    client = getClient();
  } catch (err) {
    console.error(`[WritingService:${feature}]`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'AI service is not configured.' });
    return { fullText: '', error: err };
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullText = '';
  try {
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text;
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`);
    res.end();
    return { fullText };
  } catch (err) {
    console.error(`[WritingService:${feature}]`, err.message);
    // Client-safe error message; detailed error stays in server logs
    res.write(`data: ${JSON.stringify({ error: 'Generation failed. Please try again.' })}\n\n`);
    res.end();
    return { fullText, error: err };
  }
}

module.exports = {
  // Config
  MODEL,
  getClient,
  // Enums
  MODES,
  CONTENT_TYPES,
  TONES,
  STORY_FORMATS,
  STORY_FOCUSES,
  MEETING_TYPES,
  THANKYOU_STYLES,
  DIGEST_TONES,
  DIGEST_AUDIENCES,
  // Prompt builders
  writingSystemPrompt,
  thankYouSystemPrompt,
  impactSystemPrompt,
  meetingPrepSystemPrompt,
  digestSystemPrompt,
  // Streaming helper
  streamGeneration,
};
