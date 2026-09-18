export function deployment(
  network: string | undefined,
  environment: string | undefined,
): {
  network: 'MAINNET' | 'TESTNET'
  environment: 'production' | 'development' | 'test'
} {
  if (network !== 'MAINNET' && network !== 'TESTNET') {
    throw new Error('VITE_NIMIQ_NETWORK must explicitly be MAINNET or TESTNET.')
  }
  if (environment !== 'production' && environment !== 'development' && environment !== 'test') {
    throw new Error('VITE_APP_ENV must explicitly be production, development or test.')
  }
  if ((environment === 'production') !== (network === 'MAINNET')) {
    throw new Error('Production requires MAINNET; development/test requires TESTNET.')
  }
  return { network, environment } as const
}
