import { PublicKey } from '@solana/web3.js';

export function validateSolAddress(address: string){
    try {
      const pubkey = new PublicKey(address);
      return PublicKey.isOnCurve(pubkey.toBuffer());
    } catch (error) {
      return false;
    }
}