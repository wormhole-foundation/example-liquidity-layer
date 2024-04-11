import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as winston from "winston";
import { MatchingEngineProgram } from "../../../src/matchingEngine";

export class OfferToken {
    private _authority: Keypair;
    private _address: PublicKey;
    private _balance: BN;

    private constructor(matchingEngine: MatchingEngineProgram, authority: Keypair) {
        this._authority = authority;
        this._address = splToken.getAssociatedTokenAddressSync(
            matchingEngine.mint,
            authority.publicKey,
        );
        this._balance = new BN(0);
    }

    static async initialize(
        matchingEngine: MatchingEngineProgram,
        authority: Keypair,
        logger: winston.Logger,
    ) {
        const that = new OfferToken(matchingEngine, authority);
        await that.fetchBalance(matchingEngine.program.provider.connection, logger);

        return that;
    }

    get authority() {
        return this._authority;
    }

    get address() {
        return this._address;
    }

    get balance() {
        return this._balance;
    }

    updateBalance(tokenBalance: BN, opts: { logger?: winston.Logger; signature?: string }) {
        const { logger, signature } = opts;
        if (logger) {
            if (signature) {
                logger.debug(`Update token balance: ${tokenBalance.toString()}, tx: ${signature}`);
            } else {
                logger.debug(`Update token balance: ${tokenBalance.toString()}`);
            }
        }
        this._balance = tokenBalance;
    }

    async fetchBalance(connection: Connection, logger: winston.Logger) {
        await splToken.getAccount(connection, this._address).then((token) => {
            this._balance = new BN(token.amount.toString());
            logger.debug(`Set token balance: ${this._balance.toString()}`);
        });
    }
}
