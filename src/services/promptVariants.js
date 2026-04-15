/**
 * Prompt Variants — registry for A/B testing of system prompts.
 *
 * Every generation picks one variant from this registry and writes its
 * name to writing_outputs.prompt_version. Over time the ratings and save
 * rates on those rows tell us which variant wins, and admins can promote
 * the winner by changing the weights here (or, eventually, via a
 * management UI).
 *
 * Contract:
 *   VARIANTS[feature] is an array of { name, weight, builder }
 *     name     short id stored in prompt_version (≤ 32 chars)
 *     weight   relative probability; defaults to 1 if omitted
 *     builder  function(promptParams) → system prompt string
 *
 * Ships with only baseline variants so the machinery is wired without
 * actually splitting traffic. To run an experiment, add a second variant
 * with a non-zero weight — everything downstream (tagging, analytics)
 * picks it up automatically.
 */

const {
  writingSystemPrompt,
  thankYouSystemPrompt,
  impactSystemPrompt,
  meetingPrepSystemPrompt,
  digestSystemPrompt,
} = require('./writingPrompts');

const DEFAULT_VARIANT_NAME = 'baseline';

const VARIANTS = {
  writing: [
    { name: DEFAULT_VARIANT_NAME, weight: 1, builder: writingSystemPrompt },
  ],
  thankYou: [
    { name: DEFAULT_VARIANT_NAME, weight: 1, builder: thankYouSystemPrompt },
  ],
  impact: [
    { name: DEFAULT_VARIANT_NAME, weight: 1, builder: impactSystemPrompt },
  ],
  meetingPrep: [
    { name: DEFAULT_VARIANT_NAME, weight: 1, builder: meetingPrepSystemPrompt },
  ],
  digest: [
    { name: DEFAULT_VARIANT_NAME, weight: 1, builder: digestSystemPrompt },
  ],
};

/**
 * Weighted random pick from a list of variants. A variant with weight 0 or
 * missing is skipped. When no variants with positive weight exist, returns
 * the first entry (so a misconfiguration never explodes).
 *
 * @param {string} feature
 * @param {function} [rng] - optional 0..1 random source (for deterministic tests)
 * @returns {{name:string, builder:function}}
 */
function selectVariant(feature, rng = Math.random) {
  const list = VARIANTS[feature];
  if (!list || list.length === 0) {
    throw new Error(`[promptVariants] Unknown feature: ${feature}`);
  }

  // Fast path: single variant → no random draw needed.
  if (list.length === 1) return list[0];

  const active = list.filter((v) => (v.weight || 0) > 0);
  if (active.length === 0) return list[0];

  const total = active.reduce((sum, v) => sum + v.weight, 0);
  const pick = rng() * total;
  let acc = 0;
  for (const v of active) {
    acc += v.weight;
    if (pick < acc) return v;
  }
  return active[active.length - 1];
}

/**
 * Look up a specific variant by name. Used when we need to replay a saved
 * generation with the exact variant it was originally produced by (e.g.
 * when debugging a low-rated output).
 *
 * @returns {{name:string, builder:function}|null}
 */
function getVariant(feature, name) {
  const list = VARIANTS[feature] || [];
  return list.find((v) => v.name === name) || null;
}

module.exports = {
  VARIANTS,
  DEFAULT_VARIANT_NAME,
  selectVariant,
  getVariant,
};
