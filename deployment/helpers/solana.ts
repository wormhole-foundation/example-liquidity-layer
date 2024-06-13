import { PublicKey } from '@solana/web3.js';

export const SOLANA_ADDRESS_LENGTH = 43;

export function validateSolAddress(address: string){
    try {
      const pubkey = new PublicKey(address);
      return PublicKey.isOnCurve(pubkey.toBuffer());
    } catch (error) {
      return false;
    }
}