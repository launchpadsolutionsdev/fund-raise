/**
 * Knowledge Base Router
 *
 * Determines whether the RE NXT knowledge base should be injected
 * into the system prompt based on keyword detection and conversation state.
 * This keeps API costs low by only including the large knowledge base
 * when it's actually needed.
 */

const fs = require('fs');
const path = require('path');

const KB_FILE = path.join(__dirname, '..', '..', 'data', 'renxt-knowledge-base.md');
let kbCache = null;
let kbMtime = 0;

/**
 * Load the RE NXT knowledge base from disk (cached, hot-reloads on change).
 */
function loadKnowledgeBase() {
  try {
    const stat = fs.statSync(KB_FILE);
    if (!kbCache || stat.mtimeMs !== kbMtime) {
      kbCache = fs.readFileSync(KB_FILE, 'utf-8');
      kbMtime = stat.mtimeMs;
    }
  } catch (err) {
    console.error('[KnowledgeBaseRouter] Failed to load knowledge base:', err.message);
    if (!kbCache) kbCache = '';
  }
  return kbCache;
}

const RENXT_KEYWORDS = [
  'raiser', 'raisers edge', 'renxt', 're nxt', 'nxt',
  'query', 'queries', 'report', 'export', 'import',
  'constituent', 'batch', 'gift entry', 'acknowledgment', 'acknowledgement',
  'receipt', 'tax receipt', 'merge', 'duplicate',
  'web view', 'database view', 'list', 'smart list',
  'blackbaud', 'error', 'help me with this', 'how do i',
  'troubleshoot', 'screenshot', 'stuck', 'confused',
  'campaign', 'fund', 'appeal', 'solicitor',
  'soft credit', 'tribute', 'pledge', 'recurring gift',
  'membership', 'relationship', 'spouse', 'organization',
];

/**
 * Determine if the RE NXT knowledge base should be injected for this message.
 *
 * @param {string} messageText - The current user message text
 * @param {object} conversation - The Conversation model instance (or null for new conversations)
 * @param {boolean} hasImage - Whether the message includes an uploaded image
 * @returns {boolean}
 */
function shouldInjectRENXTKnowledgeBase(messageText, conversation, hasImage) {
  // If conversation is already flagged as an RE NXT session, always inject
  if (conversation && conversation.isRenxtSession) return true;

  // If the message includes an image (likely a screenshot for troubleshooting)
  if (hasImage) return true;

  // Check current message for RE NXT keywords
  const lowerMessage = (messageText || '').toLowerCase();
  if (RENXT_KEYWORDS.some(kw => lowerMessage.includes(kw))) return true;

  return false;
}

/**
 * Get the knowledge base text block to inject into the system prompt.
 * Returns empty string if injection is not needed.
 *
 * @param {string} messageText
 * @param {object} conversation
 * @param {boolean} hasImage
 * @returns {{ inject: boolean, knowledgeBaseText: string }}
 */
function getKnowledgeBaseInjection(messageText, conversation, hasImage) {
  const inject = shouldInjectRENXTKnowledgeBase(messageText, conversation, hasImage);
  if (!inject) {
    return { inject: false, knowledgeBaseText: '' };
  }

  const kb = loadKnowledgeBase();
  if (!kb) {
    return { inject: false, knowledgeBaseText: '' };
  }

  return {
    inject: true,
    knowledgeBaseText: `\n\n[RE NXT KNOWLEDGE BASE]\n${kb}\n[/RE NXT KNOWLEDGE BASE]`,
  };
}

module.exports = {
  shouldInjectRENXTKnowledgeBase,
  getKnowledgeBaseInjection,
  loadKnowledgeBase,
};
