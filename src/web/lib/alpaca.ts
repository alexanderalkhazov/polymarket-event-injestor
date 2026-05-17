import Alpaca from "@alpacahq/alpaca-trade-api"

export const getAlpaca = (paper: boolean, keyId: string, secret: string) =>
  new Alpaca({ keyId, secretKey: secret, paper })
