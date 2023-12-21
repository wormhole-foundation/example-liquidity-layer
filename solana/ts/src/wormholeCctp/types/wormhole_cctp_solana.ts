export type WormholeCctpSolana = {
  "version": "0.0.0-alpha.8",
  "name": "wormhole_cctp_solana",
  "constants": [
    {
      "name": "UPGRADE_SEED_PREFIX",
      "type": "bytes",
      "value": "[117, 112, 103, 114, 97, 100, 101]"
    },
    {
      "name": "CUSTODY_TOKEN_SEED_PREFIX",
      "type": "bytes",
      "value": "[99, 117, 115, 116, 111, 100, 121]"
    }
  ],
  "instructions": [
    {
      "name": "initialize",
      "accounts": [
        {
          "name": "deployer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "custodian",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "upgradeAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "upgrade this program's executable. We verify this PDA address here out of convenience to get",
            "the PDA bump seed to invoke the upgrade."
          ]
        },
        {
          "name": "programData",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "bpfLoaderUpgradeableProgram",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "BPF Loader Upgradeable program.",
            "",
            "program."
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "transferTokensWithPayload",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Owner of the token account, which will have its funds burned by Circle's Token Messenger",
            "Minter program. This account also acts as the payer for Wormhole Core Bridge's publish",
            "message CPI call."
          ]
        },
        {
          "name": "custodian",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "This program's Wormhole (Core Bridge) emitter authority.",
            ""
          ]
        },
        {
          "name": "sender",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "Signer acting as the authority to invoke this instruction. This pubkey address will be",
            "encoded as the sender address.",
            "",
            "NOTE: Unlike Token Bridge, the sender address cannot be a program ID (where this could have",
            "acted as a program's authority to send tokens). We implemented it this way because we want",
            "to keep the same authority for both burning and minting. For programs, this poses a problem",
            "because the program itself cannot be the owner of a token account; its PDA acts as the",
            "owner. And because the mint recipient (in our case the mint redeemer) must be the owner of",
            "the token account when these tokens are minted, we cannot use a program ID as this",
            "authority."
          ]
        },
        {
          "name": "mint",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Payer Token Account's mint. This mint should be the same one as the one encoded in the",
            "source (payer) token account.",
            "",
            "Messenger Minter program's job to validate this mint. But we will check that this mint",
            "address matches the one encoded in the local token account."
          ]
        },
        {
          "name": "srcToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Token Account. Circle's Token Messenger Minter will burn the configured amount from",
            "this account.",
            "",
            "NOTE: This account will be managed by the sender authority. It is required that the token",
            "account owner delegate authority to the sender authority prior to executing this",
            "instruction."
          ]
        },
        {
          "name": "custodyToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Wormhole CCTP custody token account. This account will be closed at the end of this",
            "instruction. It just acts as a conduit to allow this program to be the transfer initiator in",
            "the Circle message."
          ]
        },
        {
          "name": "registeredEmitter",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Wormhole CCTP registered emitter account. This account exists only when another CCTP network",
            "is registered. Seeds = \\[\"registered_emitter\", target_chain.to_be_bytes()\\],",
            "seeds::program = Wormhole CCTP program."
          ]
        },
        {
          "name": "coreBridgeConfig",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Wormhole Core Bridge config. Seeds = \\[\"Bridge\"\\], seeds::program = Core Bridge program.",
            "",
            "instruction handler."
          ]
        },
        {
          "name": "coreMessage",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "coreEmitterSequence",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Wormhole Core Bridge emitter sequence. Seeds = \\[\"Sequence\"\\], seeds::program =Core Bridge",
            "program.",
            "",
            "instruction handler."
          ]
        },
        {
          "name": "coreFeeCollector",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Wormhole Core Bridge fee collector. Seeds = \\[\"fee_collector\"\\], seeds::program =",
            "core_bridge_program. This account should be passed in as Some(fee_collector) if there is a",
            "message fee.",
            "",
            "instruction handler."
          ]
        },
        {
          "name": "tokenMessengerMinterSenderAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's sender authority. Seeds = \\[\"sender_authority\"\\], seeds::program =",
            "token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "messageTransmitterConfig",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Circle Message Transmitter Config account, which belongs to the Message Transmitter Program.",
            "Seeds = \\[\"messenger_transmitter\"\\], seeds::program = message_transmitter_program.",
            "",
            "Messenger Minter program burns the tokens. See the account loader in the instruction",
            "handler."
          ]
        },
        {
          "name": "tokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Token Messenger account. Seeds = \\[\"token_messenger\"\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "remoteTokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Remote Token Messenger account. Seeds =",
            "\\[\"remote_token_messenger\", destination_domain.to_string()\\], seeds::program =",
            "token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "tokenMinter",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Token Minter account. Seeds = \\[\"token_minter\"\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "localToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Local Token account. Seeds = \\[\"local_token\", mint\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "coreBridgeProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenMessengerMinterProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "messageTransmitterProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": "TransferTokensWithPayloadArgs"
          }
        }
      ]
    },
    {
      "name": "redeemTokensWithPayload",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Owner of the token account, which will have its funds burned by Circle's Token Messenger",
            "Minter program. This account also acts as the payer for Wormhole Core Bridge's publish",
            "message CPI call."
          ]
        },
        {
          "name": "custodian",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "This program's Wormhole (Core Bridge) emitter authority.",
            ""
          ]
        },
        {
          "name": "vaa",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "claim",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "[claim_vaa](core_bridge::claim_vaa) is called."
          ]
        },
        {
          "name": "redeemer",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "Redeemer, who owns the token account that will receive the minted tokens.",
            "",
            "program requires that this recipient be a signer so an integrator has control over when he",
            "receives his tokens."
          ]
        },
        {
          "name": "redeemerToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Token Account. Circle's Token Messenger Minter will burn the configured amount from",
            "this account.",
            "",
            "NOTE: This account is the encoded mint recipient in the Circle message. This program",
            "adds a constraint that the redeemer must own this account."
          ]
        },
        {
          "name": "registeredEmitter",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Wormhole CCTP registered emitter account. This account exists only when another CCTP network",
            "is registered. Seeds = \\[\"registered_emitter\", target_chain.to_be_bytes()\\],",
            "seeds::program = Wormhole CCTP program."
          ]
        },
        {
          "name": "messageTransmitterAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "messageTransmitterConfig",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Circle Message Transmitter Config account, which belongs to the Message Transmitter Program.",
            "Seeds = \\[\"messenger_transmitter\"\\], seeds::program = message_transmitter_program.",
            "",
            "Messenger Minter program burns the tokens. See the account loader in the instruction",
            "handler."
          ]
        },
        {
          "name": "usedNonces",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Token Messenger account. Seeds = \\[\"token_messenger\"\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "remoteTokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Remote Token Messenger account. Seeds =",
            "\\[\"remote_token_messenger\", destination_domain.to_string()\\], seeds::program =",
            "token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "tokenMinter",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Token Minter account. Seeds = \\[\"token_minter\"\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "localToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Local Token account. Seeds = \\[\"local_token\", mint\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "The Token Messenger Minter program needs this account. We do not perform any checks",
            "in this instruction handler."
          ]
        },
        {
          "name": "tokenPair",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenMessengerMinterCustodyToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "recipients. This account is topped off by \"pre-minters\"."
          ]
        },
        {
          "name": "tokenMessengerMinterProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "messageTransmitterProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": "RedeemTokensWithPayloadArgs"
          }
        }
      ]
    },
    {
      "name": "registerEmitterAndDomain",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "custodian",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaa",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "claim",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "[claim_vaa](core_bridge::claim_vaa) is called."
          ]
        },
        {
          "name": "registeredEmitter",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "remoteTokenMessenger",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "upgradeContract",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "custodian",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaa",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "instruction handler, which also checks this account discriminator (so there is no need to",
            "check PDA seeds here)."
          ]
        },
        {
          "name": "claim",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "[claim_vaa](core_bridge_sdk::cpi::claim_vaa) is called."
          ]
        },
        {
          "name": "upgradeAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "upgrade this program's executable. We verify this PDA address here out of convenience to get",
            "the PDA bump seed to invoke the upgrade."
          ]
        },
        {
          "name": "spill",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "buffer",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "against the one encoded in the governance VAA."
          ]
        },
        {
          "name": "programData",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "thisProgram",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "bpfLoaderUpgradeableProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "custodian",
      "docs": [
        "Emitter config account. This account is used to perform the following:",
        "1. It is the emitter authority for the Core Bridge program.",
        "2. It acts as the custody token account owner for token transfers."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "upgradeAuthorityBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "registeredEmitter",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "cctpDomain",
            "type": "u32"
          },
          {
            "name": "chain",
            "type": "u16"
          },
          {
            "name": "address",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "RedeemTokensWithPayloadArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "encodedCctpMessage",
            "type": "bytes"
          },
          {
            "name": "cctpAttestation",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "TransferTokensWithPayloadArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mintRecipient",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nonce",
            "type": "u32"
          },
          {
            "name": "payload",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "ReceiveMessageParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "message",
            "type": "bytes"
          },
          {
            "name": "attestation",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "DepositForBurnWithCallerParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "docs": [
              "Transfer amount."
            ],
            "type": "u64"
          },
          {
            "name": "destinationDomain",
            "docs": [
              "Circle domain value of the token to be transferred."
            ],
            "type": "u32"
          },
          {
            "name": "mintRecipient",
            "docs": [
              "Recipient of assets on target network.",
              "",
              "NOTE: In the Token Messenger Minter program IDL, this is encoded as a Pubkey, which is",
              "weird because this address is one for another network. We are making it a 32-byte fixed",
              "array instead."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "destinationCaller",
            "docs": [
              "Expected caller on target network.",
              "",
              "NOTE: In the Token Messenger Minter program IDL, this is encoded as a Pubkey, which is",
              "weird because this address is one for another network. We are making it a 32-byte fixed",
              "array instead."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "RemoteTokenMessenger",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "domain",
            "type": "u32"
          },
          {
            "name": "tokenMessenger",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6002,
      "name": "CannotParseMessage",
      "msg": "CannotParseMessage"
    },
    {
      "code": 6003,
      "name": "InvalidGovernanceEmitter",
      "msg": "InvalidGovernanceEmitter"
    },
    {
      "code": 6004,
      "name": "InvalidGovernanceVaa",
      "msg": "InvalidGovernanceVaa"
    },
    {
      "code": 6005,
      "name": "InvalidGovernanceAction",
      "msg": "InvalidGovernanceAction"
    },
    {
      "code": 6006,
      "name": "InvalidWormholeFinality",
      "msg": "InvalidWormholeFinality"
    },
    {
      "code": 6007,
      "name": "GovernanceForAnotherChain",
      "msg": "GovernanceForAnotherChain"
    },
    {
      "code": 6008,
      "name": "ImplementationMismatch",
      "msg": "ImplementationMismatch"
    },
    {
      "code": 6009,
      "name": "InvalidForeignChain",
      "msg": "InvalidForeignChain"
    },
    {
      "code": 6010,
      "name": "InvalidForeignEmitter",
      "msg": "InvalidForeignEmitter"
    },
    {
      "code": 6011,
      "name": "InvalidCctpDomain",
      "msg": "InvalidCctpDomain"
    },
    {
      "code": 6012,
      "name": "InvalidProgramSender",
      "msg": "InvalidProgramSender"
    },
    {
      "code": 6013,
      "name": "ZeroAmount",
      "msg": "ZeroAmount"
    },
    {
      "code": 6014,
      "name": "InvalidMintRecipient",
      "msg": "InvalidMintRecipient"
    },
    {
      "code": 6015,
      "name": "ExecutableDisallowed",
      "msg": "ExecutableDisallowed"
    },
    {
      "code": 6016,
      "name": "InvalidEmitter",
      "msg": "InvalidEmitter"
    },
    {
      "code": 6017,
      "name": "InvalidWormholeCctpMessage",
      "msg": "InvalidWormholeCctpMessage"
    },
    {
      "code": 6018,
      "name": "InvalidRegisteredEmitterCctpDomain",
      "msg": "InvalidRegisteredEmitterCctpDomain"
    },
    {
      "code": 6019,
      "name": "TargetDomainNotSolana",
      "msg": "TargetDomainNotSolana"
    },
    {
      "code": 6020,
      "name": "SourceCctpDomainMismatch",
      "msg": "SourceCctpDomainMismatch"
    },
    {
      "code": 6021,
      "name": "TargetCctpDomainMismatch",
      "msg": "TargetCctpDomainMismatch"
    },
    {
      "code": 6022,
      "name": "CctpNonceMismatch",
      "msg": "CctpNonceMismatch"
    },
    {
      "code": 6023,
      "name": "InvalidCctpMessage",
      "msg": "InvalidCctpMessage"
    },
    {
      "code": 6024,
      "name": "RedeemerTokenMismatch",
      "msg": "RedeemerTokenMismatch"
    }
  ]
};

export const IDL: WormholeCctpSolana = {
  "version": "0.0.0-alpha.8",
  "name": "wormhole_cctp_solana",
  "constants": [
    {
      "name": "UPGRADE_SEED_PREFIX",
      "type": "bytes",
      "value": "[117, 112, 103, 114, 97, 100, 101]"
    },
    {
      "name": "CUSTODY_TOKEN_SEED_PREFIX",
      "type": "bytes",
      "value": "[99, 117, 115, 116, 111, 100, 121]"
    }
  ],
  "instructions": [
    {
      "name": "initialize",
      "accounts": [
        {
          "name": "deployer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "custodian",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "upgradeAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "upgrade this program's executable. We verify this PDA address here out of convenience to get",
            "the PDA bump seed to invoke the upgrade."
          ]
        },
        {
          "name": "programData",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "bpfLoaderUpgradeableProgram",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "BPF Loader Upgradeable program.",
            "",
            "program."
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "transferTokensWithPayload",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Owner of the token account, which will have its funds burned by Circle's Token Messenger",
            "Minter program. This account also acts as the payer for Wormhole Core Bridge's publish",
            "message CPI call."
          ]
        },
        {
          "name": "custodian",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "This program's Wormhole (Core Bridge) emitter authority.",
            ""
          ]
        },
        {
          "name": "sender",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "Signer acting as the authority to invoke this instruction. This pubkey address will be",
            "encoded as the sender address.",
            "",
            "NOTE: Unlike Token Bridge, the sender address cannot be a program ID (where this could have",
            "acted as a program's authority to send tokens). We implemented it this way because we want",
            "to keep the same authority for both burning and minting. For programs, this poses a problem",
            "because the program itself cannot be the owner of a token account; its PDA acts as the",
            "owner. And because the mint recipient (in our case the mint redeemer) must be the owner of",
            "the token account when these tokens are minted, we cannot use a program ID as this",
            "authority."
          ]
        },
        {
          "name": "mint",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Payer Token Account's mint. This mint should be the same one as the one encoded in the",
            "source (payer) token account.",
            "",
            "Messenger Minter program's job to validate this mint. But we will check that this mint",
            "address matches the one encoded in the local token account."
          ]
        },
        {
          "name": "srcToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Token Account. Circle's Token Messenger Minter will burn the configured amount from",
            "this account.",
            "",
            "NOTE: This account will be managed by the sender authority. It is required that the token",
            "account owner delegate authority to the sender authority prior to executing this",
            "instruction."
          ]
        },
        {
          "name": "custodyToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Wormhole CCTP custody token account. This account will be closed at the end of this",
            "instruction. It just acts as a conduit to allow this program to be the transfer initiator in",
            "the Circle message."
          ]
        },
        {
          "name": "registeredEmitter",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Wormhole CCTP registered emitter account. This account exists only when another CCTP network",
            "is registered. Seeds = \\[\"registered_emitter\", target_chain.to_be_bytes()\\],",
            "seeds::program = Wormhole CCTP program."
          ]
        },
        {
          "name": "coreBridgeConfig",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Wormhole Core Bridge config. Seeds = \\[\"Bridge\"\\], seeds::program = Core Bridge program.",
            "",
            "instruction handler."
          ]
        },
        {
          "name": "coreMessage",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "coreEmitterSequence",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Wormhole Core Bridge emitter sequence. Seeds = \\[\"Sequence\"\\], seeds::program =Core Bridge",
            "program.",
            "",
            "instruction handler."
          ]
        },
        {
          "name": "coreFeeCollector",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Wormhole Core Bridge fee collector. Seeds = \\[\"fee_collector\"\\], seeds::program =",
            "core_bridge_program. This account should be passed in as Some(fee_collector) if there is a",
            "message fee.",
            "",
            "instruction handler."
          ]
        },
        {
          "name": "tokenMessengerMinterSenderAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's sender authority. Seeds = \\[\"sender_authority\"\\], seeds::program =",
            "token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "messageTransmitterConfig",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Circle Message Transmitter Config account, which belongs to the Message Transmitter Program.",
            "Seeds = \\[\"messenger_transmitter\"\\], seeds::program = message_transmitter_program.",
            "",
            "Messenger Minter program burns the tokens. See the account loader in the instruction",
            "handler."
          ]
        },
        {
          "name": "tokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Token Messenger account. Seeds = \\[\"token_messenger\"\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "remoteTokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Remote Token Messenger account. Seeds =",
            "\\[\"remote_token_messenger\", destination_domain.to_string()\\], seeds::program =",
            "token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "tokenMinter",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Token Minter account. Seeds = \\[\"token_minter\"\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "localToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Local Token account. Seeds = \\[\"local_token\", mint\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "coreBridgeProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenMessengerMinterProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "messageTransmitterProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": "TransferTokensWithPayloadArgs"
          }
        }
      ]
    },
    {
      "name": "redeemTokensWithPayload",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Owner of the token account, which will have its funds burned by Circle's Token Messenger",
            "Minter program. This account also acts as the payer for Wormhole Core Bridge's publish",
            "message CPI call."
          ]
        },
        {
          "name": "custodian",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "This program's Wormhole (Core Bridge) emitter authority.",
            ""
          ]
        },
        {
          "name": "vaa",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "claim",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "[claim_vaa](core_bridge::claim_vaa) is called."
          ]
        },
        {
          "name": "redeemer",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "Redeemer, who owns the token account that will receive the minted tokens.",
            "",
            "program requires that this recipient be a signer so an integrator has control over when he",
            "receives his tokens."
          ]
        },
        {
          "name": "redeemerToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Token Account. Circle's Token Messenger Minter will burn the configured amount from",
            "this account.",
            "",
            "NOTE: This account is the encoded mint recipient in the Circle message. This program",
            "adds a constraint that the redeemer must own this account."
          ]
        },
        {
          "name": "registeredEmitter",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Wormhole CCTP registered emitter account. This account exists only when another CCTP network",
            "is registered. Seeds = \\[\"registered_emitter\", target_chain.to_be_bytes()\\],",
            "seeds::program = Wormhole CCTP program."
          ]
        },
        {
          "name": "messageTransmitterAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "messageTransmitterConfig",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Circle Message Transmitter Config account, which belongs to the Message Transmitter Program.",
            "Seeds = \\[\"messenger_transmitter\"\\], seeds::program = message_transmitter_program.",
            "",
            "Messenger Minter program burns the tokens. See the account loader in the instruction",
            "handler."
          ]
        },
        {
          "name": "usedNonces",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Token Messenger account. Seeds = \\[\"token_messenger\"\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "remoteTokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Remote Token Messenger account. Seeds =",
            "\\[\"remote_token_messenger\", destination_domain.to_string()\\], seeds::program =",
            "token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "tokenMinter",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Token Minter account. Seeds = \\[\"token_minter\"\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "in this instruction handler."
          ]
        },
        {
          "name": "localToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Token Messenger Minter's Local Token account. Seeds = \\[\"local_token\", mint\\],",
            "seeds::program = token_messenger_minter_program.",
            "",
            "The Token Messenger Minter program needs this account. We do not perform any checks",
            "in this instruction handler."
          ]
        },
        {
          "name": "tokenPair",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenMessengerMinterCustodyToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "recipients. This account is topped off by \"pre-minters\"."
          ]
        },
        {
          "name": "tokenMessengerMinterProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "messageTransmitterProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": "RedeemTokensWithPayloadArgs"
          }
        }
      ]
    },
    {
      "name": "registerEmitterAndDomain",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "custodian",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaa",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "claim",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "[claim_vaa](core_bridge::claim_vaa) is called."
          ]
        },
        {
          "name": "registeredEmitter",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "remoteTokenMessenger",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "upgradeContract",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "custodian",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaa",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "instruction handler, which also checks this account discriminator (so there is no need to",
            "check PDA seeds here)."
          ]
        },
        {
          "name": "claim",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "[claim_vaa](core_bridge_sdk::cpi::claim_vaa) is called."
          ]
        },
        {
          "name": "upgradeAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "upgrade this program's executable. We verify this PDA address here out of convenience to get",
            "the PDA bump seed to invoke the upgrade."
          ]
        },
        {
          "name": "spill",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "buffer",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "against the one encoded in the governance VAA."
          ]
        },
        {
          "name": "programData",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "thisProgram",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "bpfLoaderUpgradeableProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "custodian",
      "docs": [
        "Emitter config account. This account is used to perform the following:",
        "1. It is the emitter authority for the Core Bridge program.",
        "2. It acts as the custody token account owner for token transfers."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "upgradeAuthorityBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "registeredEmitter",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "cctpDomain",
            "type": "u32"
          },
          {
            "name": "chain",
            "type": "u16"
          },
          {
            "name": "address",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "RedeemTokensWithPayloadArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "encodedCctpMessage",
            "type": "bytes"
          },
          {
            "name": "cctpAttestation",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "TransferTokensWithPayloadArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mintRecipient",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nonce",
            "type": "u32"
          },
          {
            "name": "payload",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "ReceiveMessageParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "message",
            "type": "bytes"
          },
          {
            "name": "attestation",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "DepositForBurnWithCallerParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "docs": [
              "Transfer amount."
            ],
            "type": "u64"
          },
          {
            "name": "destinationDomain",
            "docs": [
              "Circle domain value of the token to be transferred."
            ],
            "type": "u32"
          },
          {
            "name": "mintRecipient",
            "docs": [
              "Recipient of assets on target network.",
              "",
              "NOTE: In the Token Messenger Minter program IDL, this is encoded as a Pubkey, which is",
              "weird because this address is one for another network. We are making it a 32-byte fixed",
              "array instead."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "destinationCaller",
            "docs": [
              "Expected caller on target network.",
              "",
              "NOTE: In the Token Messenger Minter program IDL, this is encoded as a Pubkey, which is",
              "weird because this address is one for another network. We are making it a 32-byte fixed",
              "array instead."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "RemoteTokenMessenger",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "domain",
            "type": "u32"
          },
          {
            "name": "tokenMessenger",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6002,
      "name": "CannotParseMessage",
      "msg": "CannotParseMessage"
    },
    {
      "code": 6003,
      "name": "InvalidGovernanceEmitter",
      "msg": "InvalidGovernanceEmitter"
    },
    {
      "code": 6004,
      "name": "InvalidGovernanceVaa",
      "msg": "InvalidGovernanceVaa"
    },
    {
      "code": 6005,
      "name": "InvalidGovernanceAction",
      "msg": "InvalidGovernanceAction"
    },
    {
      "code": 6006,
      "name": "InvalidWormholeFinality",
      "msg": "InvalidWormholeFinality"
    },
    {
      "code": 6007,
      "name": "GovernanceForAnotherChain",
      "msg": "GovernanceForAnotherChain"
    },
    {
      "code": 6008,
      "name": "ImplementationMismatch",
      "msg": "ImplementationMismatch"
    },
    {
      "code": 6009,
      "name": "InvalidForeignChain",
      "msg": "InvalidForeignChain"
    },
    {
      "code": 6010,
      "name": "InvalidForeignEmitter",
      "msg": "InvalidForeignEmitter"
    },
    {
      "code": 6011,
      "name": "InvalidCctpDomain",
      "msg": "InvalidCctpDomain"
    },
    {
      "code": 6012,
      "name": "InvalidProgramSender",
      "msg": "InvalidProgramSender"
    },
    {
      "code": 6013,
      "name": "ZeroAmount",
      "msg": "ZeroAmount"
    },
    {
      "code": 6014,
      "name": "InvalidMintRecipient",
      "msg": "InvalidMintRecipient"
    },
    {
      "code": 6015,
      "name": "ExecutableDisallowed",
      "msg": "ExecutableDisallowed"
    },
    {
      "code": 6016,
      "name": "InvalidEmitter",
      "msg": "InvalidEmitter"
    },
    {
      "code": 6017,
      "name": "InvalidWormholeCctpMessage",
      "msg": "InvalidWormholeCctpMessage"
    },
    {
      "code": 6018,
      "name": "InvalidRegisteredEmitterCctpDomain",
      "msg": "InvalidRegisteredEmitterCctpDomain"
    },
    {
      "code": 6019,
      "name": "TargetDomainNotSolana",
      "msg": "TargetDomainNotSolana"
    },
    {
      "code": 6020,
      "name": "SourceCctpDomainMismatch",
      "msg": "SourceCctpDomainMismatch"
    },
    {
      "code": 6021,
      "name": "TargetCctpDomainMismatch",
      "msg": "TargetCctpDomainMismatch"
    },
    {
      "code": 6022,
      "name": "CctpNonceMismatch",
      "msg": "CctpNonceMismatch"
    },
    {
      "code": 6023,
      "name": "InvalidCctpMessage",
      "msg": "InvalidCctpMessage"
    },
    {
      "code": 6024,
      "name": "RedeemerTokenMismatch",
      "msg": "RedeemerTokenMismatch"
    }
  ]
};
