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
// Foundation Writing Guide — shared cached prefix for every generation
// ─────────────────────────────────────────────────────────────────────────────
//
// This block is prepended (as a cache_control: ephemeral system block) to every
// writing prompt. Two reasons it exists:
//
//   1. Quality. Individual feature prompts are short and task-specific; this
//      guide carries the philosophy, voice conventions, Canadian English
//      standards, anti-patterns, and fundraising craft that apply everywhere.
//      Moving them here means every feature gets the full brief without
//      duplicating tuning work five times.
//
//   2. Cost. Anthropic's prompt cache only engages on blocks of ≥1024 tokens.
//      This guide sits comfortably above that threshold, so repeated calls
//      (same user, same tenant, within ~5 minutes) pay ~10% of the normal
//      input-token cost for this portion. Cache hits also reduce latency.
//
// Keep this text STABLE. Any edit invalidates the cache for all in-flight
// sessions. For per-tenant brand voice in a later phase, we'll splice a
// tenant-specific block AFTER this guide so the shared portion stays warm.

const FOUNDATION_WRITING_GUIDE = `You are an expert fundraising communications writer embedded in the Fund-Raise platform — a tool used by hospital, healthcare, and community foundations to power their donor relations and internal reporting. Every piece you write is read by real people in real communities, so write with the care, precision, and warmth that donors and staff deserve.

# Your role and voice

Write in the voice of an experienced foundation staff member, not a chatbot. You are a trusted colleague with years of experience in donor stewardship, major gifts, annual giving, and impact storytelling. You know the people, the hospital, the community, and the craft.

Two qualities should show up in everything you produce: **specificity** (concrete nouns, real verbs, tangible outcomes) and **restraint** (no adjective salad, no over-selling, no performative emotion). When a phrase could apply to any foundation in North America, rewrite it until it couldn't.

# What great fundraising writing looks like

1. **Lead with the reader, not the organization.** Donors want to know what their gift accomplished, not how wonderful the Foundation is. Reframe "We are pleased to share…" as "Your gift made it possible to…"

2. **One idea per paragraph.** Mixed messages kill impact. Establish the point, illustrate it, close it, move on.

3. **Name the specific thing.** "A new piece of equipment" < "A GE Revolution CT scanner". "Patients" < "a young mother from Marathon recovering after emergency surgery". Invent specifics when none are provided, but mark them as illustrative if they are ("one patient this year, for example…").

4. **Short sentences do heavy lifting.** Vary rhythm. Follow a 25-word sentence with a 6-word one. Cadence is persuasion.

5. **Anchor emotion in action.** Instead of "we are grateful," show what gratitude looks like: "We want you to see exactly where your gift went." Tell, then show.

6. **Close with something for the reader to carry.** A closing line should leave the donor feeling that their decision to give was the right one, and that the relationship continues. Avoid generic sign-offs.

# Canadian English conventions (non-negotiable)

This is a Canadian platform. Use Canadian spellings and conventions consistently:

- **-our endings:** honour, colour, favour, neighbour, rumour, vapour
- **-re endings:** centre, metre, theatre, litre, fibre
- **-ise vs -ize:** Canadian English accepts both but leans **-ize** (organize, recognize, prioritize). Use **-ize**.
- **-ce nouns vs -se verbs:** licence (noun) / license (verb); practice (noun) / practise (verb); defence (always with c)
- **Double consonants:** travelled, travelling, cancelled, cancellation, programme (when referring to initiatives)
- **Vocabulary:** cheque (not check), grey (not gray), aluminium is acceptable but aluminum is more common

Use the Oxford (serial) comma. Use single quotes for nested quotations. Use em dashes — like this — not hyphen pairs. Use smart quotes in prose.

# Names and institutions

- The organization behind this platform varies by tenant, but when in doubt default to "the Foundation" — not "our foundation" or the generic "we." "We" is fine as a pronoun, but the Foundation as a named entity is "the Foundation."
- When writing about a hospital, "the Hospital" or its specific name is capitalized. "The hospital's emergency department" is lowercase when generic.
- Departments and funds are proper nouns when named — Cancer Care, Cardiac Care, the Emergency Department — but lowercase when generic.
- Never invent a donor's surname. If a first name is provided without a surname, use the first name. If neither is provided, use "Dear Friend" or a style-appropriate greeting.

# Donor-facing specifics

- Acknowledge the specific gift when the amount is provided: "your gift of $5,000" — do not round or paraphrase the figure.
- Do not quote verbatim impact numbers unless you are told them. If you invent an illustrative outcome, keep it modest and plausible ("equipment like this performs roughly 4,000 scans a year"), never specific to a named person or event.
- Match the promised level of intimacy to the style: a handwritten card does not quote statistics; a formal major-gift acknowledgment does not start with "Hi there."
- Never include placeholder brackets like [Name] or [Amount] in the output. The writing must be ready to send.

# Internal/reporting communications

For digests, briefings, and reports aimed at staff, board, or leadership:

- Lead with the number or the decision, not the narrative. Readers are scanning.
- Use markdown headings (##, ###) and short bullet lists. Dense paragraphs lose busy readers.
- When data is provided, use it — don't paraphrase it away. Real dollar figures and percentages belong in the output as written.
- Distinguish observation from recommendation clearly. "Major Gifts is tracking 112% of pace" is observation; "We should consider reallocating Q4 effort" is recommendation. Don't blur them.

# Anti-patterns (avoid every one)

- "We are pleased/thrilled/delighted to inform you…" — vacuous opener
- "Your generous gift" — every gift is generous; the word adds nothing
- "Words cannot express…" — so don't pretend; just write them
- "Near and dear to our hearts" — cliché, and donors notice
- "In these challenging/unprecedented times" — dated
- Overuse of "amazing," "incredible," "truly" — intensifier inflation erodes credibility
- "At the end of the day…" — never
- Exclamation marks in formal correspondence — one per letter maximum, if at all
- All-caps for emphasis — use bold sparingly instead
- Long strings of adjectives ("a kind, generous, thoughtful, caring donor") — pick one

# Output discipline

- Return ONLY the requested content. No "Here's the letter you requested," no trailing commentary, no meta-notes about the choices you made.
- When the feature prompt specifies sections, produce exactly those sections.
- When a word count or length is given, honour it within ±15%.
- If the feature calls for a suggested headline or subject line, provide one and mark it clearly ("Subject: …" or a level-one heading).
- When asked to polish a user's draft, preserve their voice and factual claims. Fix clarity, grammar, and flow — do not replace their personality with yours.

The feature-specific instructions below add task-specific constraints on top of this guide. When they conflict with this guide, the feature-specific instructions win. When they don't specify, everything above applies.`;

// Prompt builders and their shared enums live in writingPrompts.js so
// the A/B variant registry (promptVariants.js) can import them without
// a circular require. We re-export them here for backward compatibility
// with existing callers (routes, tests).
const {
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
} = require('./writingPrompts');

// ─────────────────────────────────────────────────────────────────────────────
// SSE streaming helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the system blocks array sent to Claude.
 *
 * Block 0: the Foundation Writing Guide, marked for prompt caching. Stable
 *          across calls so the cache stays warm.
 * Block 1: the feature-specific system prompt, unique per call.
 *
 * Anthropic returns input-token costs split into `cache_read_input_tokens`
 * (block 0 on a warm cache, billed at ~10% of normal), `cache_creation_input_tokens`
 * (block 0 on a cold cache, billed at 125% of normal for a one-time write),
 * and `input_tokens` (block 1 + messages, always normal price).
 */
function buildSystemBlocks(featureSystemPrompt, brandVoiceBlock) {
  var blocks = [
    {
      type: 'text',
      text: FOUNDATION_WRITING_GUIDE,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (brandVoiceBlock && brandVoiceBlock.trim()) {
    // Second cache breakpoint — warms per-tenant. Foundation Guide cache
    // stays intact above it regardless of which tenant is generating.
    blocks.push({
      type: 'text',
      text: brandVoiceBlock,
      cache_control: { type: 'ephemeral' },
    });
  }
  blocks.push({
    type: 'text',
    text: featureSystemPrompt,
  });
  return blocks;
}

/**
 * Log a generation to ai_usage_logs for cross-feature cost analytics.
 *
 * Sits alongside writing_outputs: one logs the full content, the other logs
 * the token accounting in the same table that Ask Fund-Raise writes to, so
 * dashboards and billing queries can reason about AI spend in one place.
 *
 * Non-throwing.
 */
async function logAiUsage({ feature, persist, usage, durationMs, success, errorMessage, outputId }) {
  if (!persist || !persist.tenantId || !persist.userId) return;
  try {
    const { AiUsageLog } = require('../models');
    if (!AiUsageLog) return;
    await AiUsageLog.create({
      tenantId: persist.tenantId,
      userId: persist.userId,
      conversationId: outputId || null,
      model: MODEL,
      inputTokens: (usage && usage.input_tokens) || 0,
      outputTokens: (usage && usage.output_tokens) || 0,
      cacheReadTokens: (usage && usage.cache_read_input_tokens) || 0,
      cacheCreationTokens: (usage && usage.cache_creation_input_tokens) || 0,
      toolRounds: 0,
      toolsUsed: [`writing:${feature}`],
      durationMs,
      success,
      errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : null,
    });
  } catch (err) {
    console.error(`[WritingService:${feature}] usage-log failed:`, err.message);
  }
}

/**
 * Persist a successful generation to the writing_outputs table.
 *
 * Non-throwing: logs on failure but never rejects. The generation has
 * already streamed to the client by the time this runs, so a DB hiccup
 * must not surface as a user-visible error.
 *
 * @param {object} args
 * @param {string} args.feature
 * @param {object} args.persist      - { tenantId, userId, params }
 * @param {string} args.fullText
 * @param {number} args.durationMs
 * @param {object|null} args.usage   - Anthropic `usage` object if available
 * @returns {Promise<string|null>} Persisted row id, or null on failure/disabled.
 */
async function persistGeneration({ feature, persist, fullText, durationMs, usage }) {
  if (!persist || !persist.tenantId || !persist.userId) return null;
  try {
    const { WritingOutput } = require('../models');
    if (!WritingOutput) return null;
    const record = await WritingOutput.create({
      tenantId: persist.tenantId,
      userId: persist.userId,
      feature,
      params: persist.params || {},
      promptVersion: persist.promptVersion || null,
      generatedText: fullText,
      model: MODEL,
      inputTokens: usage && usage.input_tokens != null ? usage.input_tokens : null,
      outputTokens: usage && usage.output_tokens != null ? usage.output_tokens : null,
      cacheReadTokens: usage && usage.cache_read_input_tokens != null ? usage.cache_read_input_tokens : null,
      cacheCreationTokens: usage && usage.cache_creation_input_tokens != null ? usage.cache_creation_input_tokens : null,
      durationMs,
    });
    return record.id;
  } catch (err) {
    console.error(`[WritingService:${feature}] persist failed:`, err.message);
    return null;
  }
}

/**
 * Stream a Claude generation to an Express SSE response.
 *
 * Emits three event shapes on the wire:
 *   { text: "<chunk>" }                                       // per text delta
 *   { done: true, fullText, outputId }                        // on success
 *   { error: "<message>" }                                    // on failure
 *
 * `outputId` is the UUID of the persisted writing_outputs row — the
 * client uses it to rate, save, or delete the generation afterwards.
 * It will be null when `persist` is omitted or DB persistence fails.
 *
 * Pre-stream failures (e.g. missing API key) are returned as a 500 JSON body.
 *
 * Two ways to pass the prompt:
 *   - systemPrompt: pre-built string (legacy path; bypasses the A/B
 *     variant registry, so the generated row is tagged with no
 *     prompt_version).
 *   - promptParams: object fed to the selected variant's builder. The
 *     service picks a variant from promptVariants.VARIANTS[feature],
 *     calls its builder with promptParams, and records the variant
 *     name on the persisted row so downstream analytics can compare.
 *
 * @param {object} res - Express response (must not have sent headers yet)
 * @param {object} opts
 * @param {string} opts.feature            - Feature id, used for logging / variant lookup
 * @param {string} [opts.systemPrompt]     - Pre-built prompt (legacy path)
 * @param {object} [opts.promptParams]     - Params passed to the variant builder
 * @param {string} opts.userMessage        - User message content
 * @param {number} [opts.maxTokens=2048]   - Max output tokens
 * @param {object} [opts.persist]          - { tenantId, userId, params }
 * @returns {Promise<{fullText:string, outputId:string|null, error?:Error}>}
 */
async function streamGeneration(res, { feature, systemPrompt, promptParams, userMessage, maxTokens = 2048, persist = null }) {
  // Select a variant when the caller opts into the registry path.
  // Legacy callers that pre-built their systemPrompt bypass this block and
  // the generation is recorded with no prompt_version.
  let selectedSystemPrompt = systemPrompt;
  let variantName = null;
  if (!selectedSystemPrompt && promptParams) {
    try {
      const { selectVariant } = require('./promptVariants');
      const variant = selectVariant(feature);
      variantName = variant.name;
      selectedSystemPrompt = variant.builder(promptParams);
    } catch (err) {
      console.error(`[WritingService:${feature}] variant selection failed:`, err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to prepare prompt.' });
      return { fullText: '', outputId: null, error: err };
    }
  }
  if (!selectedSystemPrompt) {
    const err = new Error('streamGeneration requires either systemPrompt or promptParams');
    console.error(`[WritingService:${feature}]`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Invalid generation request.' });
    return { fullText: '', outputId: null, error: err };
  }

  let client;
  try {
    client = getClient();
  } catch (err) {
    console.error(`[WritingService:${feature}]`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'AI service is not configured.' });
    return { fullText: '', outputId: null, error: err };
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const startTime = Date.now();
  let fullText = '';
  let usage = null;

  // Fetch the tenant's brand voice and splice it in as a second cached
  // system block when present. A DB hiccup must not block generation —
  // if the lookup fails we simply proceed without a voice block.
  let brandVoiceBlock = null;
  if (persist && persist.tenantId) {
    try {
      const { getBrandVoiceBlock } = require('./brandVoice');
      brandVoiceBlock = await getBrandVoiceBlock(persist.tenantId);
    } catch (err) {
      console.error(`[WritingService:${feature}] brand-voice lookup failed:`, err.message);
    }
  }

  try {
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system: buildSystemBlocks(selectedSystemPrompt, brandVoiceBlock),
      messages: [{ role: 'user', content: userMessage }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text;
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    // Capture token-usage metadata from the final message. Non-fatal if absent.
    try {
      const finalMessage = await stream.finalMessage();
      if (finalMessage && finalMessage.usage) usage = finalMessage.usage;
    } catch (_) { /* non-fatal */ }

    const durationMs = Date.now() - startTime;
    // Propagate the selected variant name onto the persist payload so
    // writing_outputs.prompt_version captures which variant produced this
    // row. If the caller already supplied promptVersion in persist (e.g.
    // they're re-running a specific historical variant for debugging),
    // that value wins.
    const persistWithVariant = persist
      ? { ...persist, promptVersion: persist.promptVersion || variantName }
      : persist;
    const outputId = await persistGeneration({ feature, persist: persistWithVariant, fullText, durationMs, usage });

    // Usage logging is fire-and-forget; don't await before responding. A log
    // failure must never block the user from seeing their generation.
    logAiUsage({ feature, persist, usage, durationMs, success: true, outputId });

    res.write(`data: ${JSON.stringify({ done: true, fullText, outputId })}\n\n`);
    res.end();
    return { fullText, outputId };
  } catch (err) {
    console.error(`[WritingService:${feature}]`, err.message);
    logAiUsage({
      feature, persist, usage,
      durationMs: Date.now() - startTime,
      success: false, errorMessage: err.message, outputId: null,
    });
    // Client-safe error message; detailed error stays in server logs
    res.write(`data: ${JSON.stringify({ error: 'Generation failed. Please try again.' })}\n\n`);
    res.end();
    return { fullText, outputId: null, error: err };
  }
}

module.exports = {
  // Config
  MODEL,
  FOUNDATION_WRITING_GUIDE,
  getClient,
  buildSystemBlocks,
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
