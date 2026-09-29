/**
 * measure-chat-latency.mjs — where does the chatbot's latency actually go?
 *
 * The chatbot is already streaming, so "slow" has to be decomposed rather than
 * guessed at. Four measurements against the real relay:
 *
 *   1  TIME TO FIRST TOKEN  — what the user perceives as "thinking"
 *   2  TOTAL TIME          — the whole reply
 *   3  TOKENS/SECOND       — is generation the bottleneck, or the wait before it
 *   4  EFFECT OF PROMPT SIZE — the client ships a telemetry system prompt plus
 *      16 turns of history on every message. If TTFT scales with that, the fix
 *      is trimming context; if it does not, the fix is elsewhere.
 *
 * Runs each case twice so a cold connection is not mistaken for the steady
 * state, and reports the warm number.
 */
const RELAY = 'http://localhost:3001/api/chat';

const small = [
  { role: 'system', content: 'You are NEXORA, a flood-response assistant. Answer briefly.' },
  { role: 'user', content: 'What is the water level at Chepauk?' },
];

// Approximates the real payload: a telemetry system prompt + 16 turns.
const big = [
  {
    role: 'system',
    content: `You are NEXORA, a district flood-resilience platform for Chennai.
Live telemetry snapshot:
${Array.from({ length: 28 }, (_, i) => `  station-${i}: waterLevelCm=${60 + i} normal=${30 + i} danger=${90 + i} rainfallMm=${i} rssi=-${70 + i}`).join('\n')}
Answer concisely and cite the station and level.`.repeat(3),
  },
  ...Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Earlier exchange number ${i} about river gauge readings and shelter capacity planning.` })),
  { role: 'user', content: 'What is the water level at Chepauk?' },
];

async function run(label, messages, maxTokens) {
  const t0 = Date.now();
  let ttft = null;
  let chars = 0;
  try {
    const res = await fetch(RELAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, stream: true, max_tokens: maxTokens }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.log(`  ${label.padEnd(30)} HTTP ${res.status}  ${Date.now() - t0}ms  ${t.slice(0, 120)}`);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (ttft === null) ttft = Date.now() - t0;
      chars += dec.decode(value, { stream: true }).length;
    }
    const total = Date.now() - t0;
    const cps = ttft ? Math.round(chars / ((total - ttft) / 1000)) : 0;
    console.log(
      `  ${label.padEnd(30)} ttft=${String(ttft ?? '-').padStart(6)}ms  total=${String(total).padStart(6)}ms  gen=${String(cps).padStart(5)} ch/s  ~${chars} chars`
    );
  } catch (e) {
    console.log(`  ${label.padEnd(30)} ERROR ${e.message}`);
  }
}

const bytes = (m) => JSON.stringify(m).length;

console.log(`relay: ${RELAY}\n`);
console.log(`payload sizes   small=${bytes(small)}B   large=${bytes(big)}B\n`);

console.log('run 1 (cold)');
await run('small prompt, 200 tok', small, 200);
await run('large prompt+history, 200', big, 200);

console.log('\nrun 2 (warm)');
await run('small prompt, 200 tok', small, 200);
await run('large prompt+history, 200', big, 200);
await run('small prompt, 60 tok', small, 60);
