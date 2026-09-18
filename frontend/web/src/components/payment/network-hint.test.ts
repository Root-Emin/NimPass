import { describe, expect, it } from 'vitest'

import { networkHint } from './network-hint'

/**
 * The one place the product tells a customer what to do about the network.
 *
 * Nimiq Pay owns network selection and its Mini Apps API exposes neither a
 * switch nor a way to read the current one, so this copy is all Nimpass can
 * offer — which makes it worth getting exactly right. It used to say "For
 * Testnet, long-press Settings for 10 seconds and choose Testnet"
 * unconditionally, which on a Mainnet deployment is an instruction to move a
 * real wallet onto play money before paying.
 *
 * It follows `request.network` — the network the backend stamped on this
 * purchase intent — rather than the build, so what a customer is told always
 * matches the intent they are about to pay.
 * Ref: https://nimiq.dev/mini-apps/development/load-local-mini-app
 */
describe('Nimiq Pay network instruction', () => {
  it('never tells a Mainnet customer to select Testnet', () => {
    const hint = networkHint('MAINNET')
    expect(hint).not.toMatch(/choose Testnet/i)
    expect(hint).not.toMatch(/long-press/i)
    expect(hint).toMatch(/Mainnet/)
  })

  it('still explains the Testnet switch on a Testnet intent', () => {
    // A production Nimiq Pay build defaults to Mainnet, so Testnet always
    // needs the deliberate switch through the hidden developer menu.
    const hint = networkHint('TESTNET')
    expect(hint).toMatch(/Testnet/)
    expect(hint).toMatch(/long-press/i)
  })

  it('gives a different answer per network rather than one generic sentence', () => {
    expect(networkHint('MAINNET')).not.toBe(networkHint('TESTNET'))
  })
})
