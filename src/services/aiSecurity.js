/**
 * AI Security Utilities
 *
 * Input sanitization, prompt injection detection, and output filtering
 * for the Ask Fund-Raise AI system.
 */

// ---------------------------------------------------------------------------
// Prompt Injection Detection
// ---------------------------------------------------------------------------

// Patterns that indicate prompt injection attempts
const INJECTION_PATTERNS = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions|prompts|rules)/i,
  /forget\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions|prompts|rules)/i,
  /override\s+(system|safety|security)\s*(prompt|instruction|rule)/i,
  // System prompt extraction
  /what\s+(is|are)\s+your\s+(system\s+)?(prompt|instructions|rules)/i,
  /repeat\s+(your\s+)?(system\s+)?(prompt|instructions)/i,
  /show\s+me\s+(your\s+)?(system\s+)?(prompt|instructions|rules)/i,
  /print\s+(your\s+)?(system\s+)?(prompt|instructions)/i,
  // Role play / jailbreak
  /you\s+are\s+now\s+(DAN|evil|unfiltered|unrestricted)/i,
  /pretend\s+you\s+(are|have)\s+no\s+(rules|restrictions|limits)/i,
  /act\s+as\s+(if|though)\s+you\s+have\s+no\s+(restrictions|safety)/i,
  /enter\s+(DAN|developer|god|admin)\s+mode/i,
  // XML/tool injection
  /<tool_call>/i,
  /<tool_response>/i,
  /<\/?system>/i,
  /<\/?function_call>/i,
];

/**
 * Check a user message for prompt injection patterns.
 *
 * @param {string} text - User message text
 * @returns {{ flagged: boolean, pattern: string|null }}
 */
function detectInjection(text) {
  if (!text || typeof text !== 'string') return { flagged: false, pattern: null };

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { flagged: true, pattern: pattern.source };
    }
  }

  return { flagged: false, pattern: null };
}

// ---------------------------------------------------------------------------
// Link Sanitization (XSS prevention for rendered markdown)
// ---------------------------------------------------------------------------

// Allowed URL schemes in rendered markdown links
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];

/**
 * Sanitize a URL to prevent javascript: and other dangerous schemes.
 *
 * @param {string} url
 * @returns {string} Safe URL or empty string
 */
function sanitizeUrl(url) {
  if (!url) return '';
  const trimmed = url.trim();

  // Block data: URIs (except small harmless ones)
  if (trimmed.toLowerCase().startsWith('data:') && !trimmed.toLowerCase().startsWith('data:image/')) {
    return '';
  }

  // Block javascript: and vbscript: schemes
  try {
    const parsed = new URL(trimmed, 'https://placeholder.invalid');
    if (!SAFE_SCHEMES.includes(parsed.protocol)) {
      return '';
    }
  } catch {
    // Relative URLs are OK
    if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) {
      return trimmed;
    }
    return '';
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Output Sanitization
// ---------------------------------------------------------------------------

/**
 * Strip tool_call / tool_response XML blocks that Claude sometimes narrates.
 * (Moved from aiService.js for centralization.)
 */
function sanitizeToolNarrative(text) {
  if (!text) return text;
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>\s*/g, '')
    .replace(/<tool_response>[\s\S]*?<\/tool_response>\s*/g, '')
    .replace(/<tool_call>[\s\S]*?(?=\n\n|$)/g, '')
    .replace(/<tool_response>[\s\S]*?(?=\n\n|$)/g, '')
    .trim();
}

module.exports = {
  detectInjection,
  sanitizeUrl,
  sanitizeToolNarrative,
  INJECTION_PATTERNS,
};
