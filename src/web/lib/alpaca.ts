import Alpaca from "@alpacahq/alpaca-trade-api"

export const getAlpaca = (paper: boolean, keyId?: string, secret?: string) =>
  new Alpaca({
    keyId: keyId ?? process.env.ALPACA_KEY_ID!,
    secretKey: secret ?? process.env.ALPACA_SECRET_KEY!,
    paper,
  })
