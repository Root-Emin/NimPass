/**
 * Nimiq Pay scanner capability probe.
 *
 * Nimpass needs one fact that no official document states: which QR payloads
 * the Nimiq Pay *payment* scanner (Pay → Scan) accepts for NIM, and whether the
 * accepted payload can carry our NP1 purchase reference into the transaction's
 * data field. Nimiq Pay is closed source and nimiq.dev documents the request
 * link formats (`@nimiq/utils/request-link-encoding`) without saying which app
 * reads which. So this is measured on a device instead of assumed.
 *
 * The script renders one QR per candidate format, all carrying the same
 * recipient, amount and reference, into a self-contained HTML page. Scan each
 * one in Nimiq Pay and write down what happens. Nothing here talks to Nimpass,
 * the backend or the chain: it is a measuring instrument, not part of the app.
 *
 *   node scripts/nimiq-pay-scan-probe.mjs --address "NQ.. your testnet address"
 *
 * Options: --amount <NIM, default 1> --reference <NP1:32hex> --out <file>
 */
import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import QRCode from 'qrcode'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])

const address = String(args.get('address') ?? '').toUpperCase().replace(/\s+/g, '')
const amount = String(args.get('amount') ?? '1')
const reference = String(args.get('reference') ?? `NP1:${randomBytes(16).toString('hex')}`)
const out = resolve(String(args.get('out') ?? 'nimiq-pay-scan-probe.html'))

/** IBAN-style mod-97 check, the same one `ValidationUtils` applies in the wallet. */
function isValidNimiqAddress(value) {
  if (!/^NQ[0-9A-Z]{34}$/.test(value)) return false
  const rearranged = value.slice(4) + value.slice(0, 4)
  let remainder = 0
  for (const character of rearranged) {
    const code = character.charCodeAt(0)
    const digits = code >= 65 ? String(code - 55) : character
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

if (!isValidNimiqAddress(address)) {
  console.error('--address must be a valid Nimiq address (copy yours from Nimiq Pay → Receive).')
  process.exit(1)
}
if (!/^\d+(\.\d{1,5})?$/.test(amount)) {
  console.error('--amount must be decimal NIM with at most 5 decimals, e.g. 1 or 0.5')
  process.exit(1)
}
if (!/^NP1:[0-9a-f]{32}$/.test(reference)) {
  console.error('--reference must look like a Nimpass payment reference: NP1:<32 hex>')
  process.exit(1)
}

// Encodings follow nimiq/nimiq-utils `createNimiqRequestLink` exactly: the URI
// form takes decimal NIM in `amount` and a URI-encoded `message`; the Safe form
// is positional `#_request/<recipient>/<amount>/<message>_`.
const encodedReference = encodeURIComponent(reference)
const candidates = [
  { id: 'A', name: 'Bare address', value: address,
    asks: 'Baseline: does the scanner accept a plain Nimiq address at all?' },
  { id: 'B', name: 'nimiq: URI, amount only', value: `nimiq:${address}?amount=${amount}`,
    asks: 'Does it prefill the amount?' },
  { id: 'C', name: 'nimiq: URI, amount + message', value: `nimiq:${address}?amount=${amount}&message=${encodedReference}`,
    asks: 'THE DECISIVE ONE. Accepted? Amount prefilled? Is the reference shown as a message/note?' },
  { id: 'D', name: 'Safe/wallet request link', value: `https://wallet.nimiq.com/#_request/${address}/${amount}/${encodedReference}_`,
    asks: 'Older https request-link form, still produced by the Nimiq Wallet.' },
  { id: 'E', name: 'web+nim URI', value: `web+nim://${address}?amount=${amount}&message=${encodedReference}`,
    asks: 'The third official request-link type.' },
]

const rows = await Promise.all(candidates.map(async (candidate) => ({
  ...candidate,
  qr: await QRCode.toDataURL(candidate.value, { width: 320, margin: 2, errorCorrectionLevel: 'M' }),
})))

const escape = (value) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

writeFileSync(out, `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nimiq Pay scanner probe</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;margin:0 auto;padding:24px;max-width:860px;color:#1f2348}
 h1{font-size:22px;margin:0 0 4px} h2{font-size:17px;margin:0 0 4px}
 .card{border:1px solid #d7dae8;border-radius:14px;padding:16px;margin:16px 0;display:flex;gap:18px;flex-wrap:wrap}
 .card img{width:220px;height:220px}
 code{background:#f2f3f8;padding:2px 5px;border-radius:5px;word-break:break-all;font-size:12px}
 .meta{flex:1;min-width:260px} .ask{color:#6b6f8c} ol{padding-left:20px}
 .head{background:#f7f8fc;border-radius:14px;padding:16px}
</style>
<h1>Nimiq Pay scanner probe</h1>
<p>Recipient <code>${escape(address)}</code> · amount <code>${escape(amount)} NIM</code> · reference <code>${escape(reference)}</code></p>
<div class="head">
<ol>
 <li>Open <b>Nimiq Pay</b> on the phone and switch it to <b>Testnet</b> (long-press Settings for 10 seconds).</li>
 <li>Tap <b>Pay</b> → the scanner, and scan each code below from this screen.</li>
 <li>For each one write down: <b>accepted or rejected</b> (copy the exact error),
     and if accepted whether the prepared transaction shows the right
     <b>recipient</b>, the right <b>amount</b>, and the <b>reference as a message</b>.</li>
 <li>Do not confirm anything yet. Only after a candidate is accepted <i>with</i>
     the reference visible, send it once on Testnet and check the transaction's
     data field on chain — that is the only proof the reference survives.</li>
</ol>
</div>
${rows.map((row) => `<div class="card">
 <img src="${row.qr}" alt="QR for ${escape(row.name)}">
 <div class="meta"><h2>${row.id} · ${escape(row.name)}</h2>
 <p class="ask">${escape(row.asks)}</p>
 <p><code>${escape(row.value)}</code></p></div>
</div>`).join('\n')}
`)

console.log(`Wrote ${out}`)
for (const candidate of candidates) console.log(`${candidate.id}: ${candidate.value}`)
