export type MatchingEngine = {
  "version": "0.0.0",
  "name": "matching_engine",
  "instructions": [
    {
      "name": "completeFastFill",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "fastFillVaa",
          "accounts": [
            {
              "name": "vaa",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "redeemedFastFill",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenRouterEmitter",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenRouterCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "routerEndpoint",
          "accounts": [
            {
              "name": "endpoint",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "localCustodyToken",
          "isMut": true,
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
      "args": []
    },
    {
      "name": "prepareOrderResponseCctp",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "fastVaa",
          "accounts": [
            {
              "name": "vaa",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "finalizedVaa",
          "accounts": [
            {
              "name": "vaa",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "preparedOrderResponse",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "preparedCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdc",
          "accounts": [
            {
              "name": "mint",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "cctp",
          "accounts": [
            {
              "name": "mintRecipient",
              "accounts": [
                {
                  "name": "mintRecipient",
                  "isMut": true,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "messageTransmitterAuthority",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "messageTransmitterConfig",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "usedNonces",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "first_nonce.to_string()\\] (CCTP Message Transmitter program)."
              ]
            },
            {
              "name": "messageTransmitterEventAuthority",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "tokenMessenger",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "remoteTokenMessenger",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Messenger Minter program)."
              ]
            },
            {
              "name": "tokenMinter",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "localToken",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "Token Messenger Minter's Local Token account. This program uses the mint of this account to",
                "validate the `mint_recipient` token account's mint.",
                ""
              ]
            },
            {
              "name": "tokenPair",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Token Messenger Minter program)."
              ]
            },
            {
              "name": "tokenMessengerMinterCustodyToken",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "tokenMessengerMinterEventAuthority",
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
            }
          ]
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
            "defined": "CctpMessageArgs"
          }
        }
      ]
    },
    {
      "name": "settleAuctionComplete",
      "accounts": [
        {
          "name": "executor",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "we will always reward the owner of the executor token account with the lamports from the",
            "prepared order response and its custody token account when we close these accounts. This",
            "means we disregard the `prepared_by` field in the prepared order response."
          ]
        },
        {
          "name": "executorToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "bestOfferToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Destination token account, which the redeemer may not own. But because the redeemer is a",
            "signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent",
            "to any account he chooses (this one).",
            ""
          ]
        },
        {
          "name": "preparedOrderResponse",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "preparedCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "auction",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "settleAuctionNoneCctp",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "payerSequence",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "coreMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "cctpMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "feeRecipientToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Destination token account, which the redeemer may not own. But because the redeemer is a",
            "signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent",
            "to any account he chooses (this one).",
            ""
          ]
        },
        {
          "name": "prepared",
          "accounts": [
            {
              "name": "by",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "orderResponse",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "custodyToken",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "fastOrderPath",
          "accounts": [
            {
              "name": "fastVaa",
              "accounts": [
                {
                  "name": "vaa",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "from",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "to",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "auction",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "There should be no account data here because an auction was never created."
          ]
        },
        {
          "name": "wormhole",
          "accounts": [
            {
              "name": "config",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "emitterSequence",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "feeCollector",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "coreBridgeProgram",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "cctp",
          "accounts": [
            {
              "name": "burnSource",
              "accounts": [
                {
                  "name": "mintRecipient",
                  "isMut": true,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "mint",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "Circle-supported mint.",
                "",
                "Token Messenger Minter program's local token account."
              ]
            },
            {
              "name": "tokenMessengerMinterSenderAuthority",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "messageTransmitterConfig",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "tokenMessenger",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "remoteTokenMessenger",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Messenger Minter program)."
              ]
            },
            {
              "name": "tokenMinter",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "CHECK Seeds must be \\[\"token_minter\"\\] (CCTP Token Messenger Minter program)."
              ]
            },
            {
              "name": "localToken",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "Local token account, which this program uses to validate the `mint` used to burn.",
                ""
              ]
            },
            {
              "name": "tokenMessengerMinterEventAuthority",
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
            }
          ]
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
          "name": "sysvars",
          "accounts": [
            {
              "name": "clock",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.",
                ""
              ]
            },
            {
              "name": "rent",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.",
                ""
              ]
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "settleAuctionNoneLocal",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "payerSequence",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "coreMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "feeRecipientToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Destination token account, which the redeemer may not own. But because the redeemer is a",
            "signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent",
            "to any account he chooses (this one).",
            ""
          ]
        },
        {
          "name": "prepared",
          "accounts": [
            {
              "name": "by",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "orderResponse",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "custodyToken",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "fastOrderPath",
          "accounts": [
            {
              "name": "fastVaa",
              "accounts": [
                {
                  "name": "vaa",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "from",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "to",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "auction",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "There should be no account data here because an auction was never created."
          ]
        },
        {
          "name": "wormhole",
          "accounts": [
            {
              "name": "config",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "emitterSequence",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "feeCollector",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "coreBridgeProgram",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "localCustodyToken",
          "isMut": true,
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
          "name": "sysvars",
          "accounts": [
            {
              "name": "clock",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.",
                ""
              ]
            },
            {
              "name": "rent",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.",
                ""
              ]
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "This instruction is be used to generate your program's config.",
        "And for convenience, we will store Wormhole-related PDAs in the",
        "config so we can verify these accounts with a simple == constraint."
      ],
      "accounts": [
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Owner of the program, who presumably deployed this program."
          ]
        },
        {
          "name": "custodian",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Custodian account, which saves program data useful for other",
            "instructions."
          ]
        },
        {
          "name": "auctionConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "ownerAssistant",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "TODO: do we prevent the owner from being the owner assistant?"
          ]
        },
        {
          "name": "feeRecipient",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "feeRecipientToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "cctpMintRecipient",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdc",
          "accounts": [
            {
              "name": "mint",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "programData",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "We use the program data to make sure this owner is the upgrade authority (the true owner,",
            "who deployed this program)."
          ]
        },
        {
          "name": "upgradeManagerAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "upgradeManagerProgram",
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
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "auctionParams",
          "type": {
            "defined": "AuctionParameters"
          }
        }
      ]
    },
    {
      "name": "setPause",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "ownerOrAssistant",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        }
      ],
      "args": [
        {
          "name": "pause",
          "type": "bool"
        }
      ]
    },
    {
      "name": "addCctpRouterEndpoint",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "admin",
          "accounts": [
            {
              "name": "ownerOrAssistant",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "routerEndpoint",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "localRouterEndpoint",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Local router endpoint PDA.",
            "",
            "NOTE: This account may not exist yet. But we need to pass it since it will be the owner of",
            "the local custody token account.",
            ""
          ]
        },
        {
          "name": "localCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdc",
          "accounts": [
            {
              "name": "mint",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "remoteTokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Messenger Minter program)."
          ]
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
            "defined": "AddCctpRouterEndpointArgs"
          }
        }
      ]
    },
    {
      "name": "addLocalRouterEndpoint",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "admin",
          "accounts": [
            {
              "name": "ownerOrAssistant",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "routerEndpoint",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "local",
          "accounts": [
            {
              "name": "tokenRouterProgram",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "emitter (router endpoint) address."
              ]
            },
            {
              "name": "tokenRouterEmitter",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "tokenRouterMintRecipient",
              "isMut": false,
              "isSigner": false
            }
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
      "name": "disableRouterEndpoint",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "routerEndpoint",
          "accounts": [
            {
              "name": "endpoint",
              "isMut": true,
              "isSigner": false
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "updateCctpRouterEndpoint",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "routerEndpoint",
          "accounts": [
            {
              "name": "endpoint",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "remoteTokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Messenger Minter program)."
          ]
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": "AddCctpRouterEndpointArgs"
          }
        }
      ]
    },
    {
      "name": "updateLocalRouterEndpoint",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "routerEndpoint",
          "accounts": [
            {
              "name": "endpoint",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "local",
          "accounts": [
            {
              "name": "tokenRouterProgram",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "emitter (router endpoint) address."
              ]
            },
            {
              "name": "tokenRouterEmitter",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "tokenRouterMintRecipient",
              "isMut": false,
              "isSigner": false
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "submitOwnershipTransferRequest",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "newOwner",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "New Owner.",
            ""
          ]
        }
      ],
      "args": []
    },
    {
      "name": "confirmOwnershipTransferRequest",
      "accounts": [
        {
          "name": "pendingOwner",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "Must be the pending owner of the program set in the [`OwnerConfig`]",
            "account."
          ]
        },
        {
          "name": "custodian",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "cancelOwnershipTransferRequest",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "proposeAuctionParameters",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "admin",
          "accounts": [
            {
              "name": "ownerOrAssistant",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "proposal",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "epochSchedule",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": "AuctionParameters"
          }
        }
      ]
    },
    {
      "name": "updateAuctionParameters",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "proposal",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "auctionConfig",
          "isMut": true,
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
      "name": "updateOwnerAssistant",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "newOwnerAssistant",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "New Assistant.",
            ""
          ]
        }
      ],
      "args": []
    },
    {
      "name": "updateFeeRecipient",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "ownerOrAssistant",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "newFeeRecipientToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "newFeeRecipient",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "New Fee Recipient.",
            ""
          ]
        }
      ],
      "args": []
    },
    {
      "name": "placeInitialOffer",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "transferAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "The auction participant needs to set approval to this PDA.",
            ""
          ]
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "auctionConfig",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "fastOrderPath",
          "accounts": [
            {
              "name": "fastVaa",
              "accounts": [
                {
                  "name": "vaa",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "from",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "to",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "auction",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "This account should only be created once, and should never be changed to",
            "init_if_needed. Otherwise someone can game an existing auction."
          ]
        },
        {
          "name": "offerToken",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the auction PDA."
          ]
        },
        {
          "name": "auctionCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdc",
          "accounts": [
            {
              "name": "mint",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "feeOffer",
          "type": "u64"
        }
      ]
    },
    {
      "name": "improveOffer",
      "accounts": [
        {
          "name": "transferAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "The auction participant needs to set approval to this PDA.",
            ""
          ]
        },
        {
          "name": "activeAuction",
          "accounts": [
            {
              "name": "auction",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "custodyToken",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "config",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "bestOfferToken",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "offerToken",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the auction PDA."
          ]
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "feeOffer",
          "type": "u64"
        }
      ]
    },
    {
      "name": "executeFastOrderCctp",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "payerSequence",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "coreMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "cctpMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "executeOrder",
          "accounts": [
            {
              "name": "fastVaa",
              "accounts": [
                {
                  "name": "vaa",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "activeAuction",
              "accounts": [
                {
                  "name": "auction",
                  "isMut": true,
                  "isSigner": false
                },
                {
                  "name": "custodyToken",
                  "isMut": true,
                  "isSigner": false
                },
                {
                  "name": "config",
                  "isMut": false,
                  "isSigner": false
                },
                {
                  "name": "bestOfferToken",
                  "isMut": true,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "toRouterEndpoint",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "executorToken",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "initialOfferToken",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "wormhole",
          "accounts": [
            {
              "name": "config",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "emitterSequence",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "feeCollector",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "coreBridgeProgram",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "cctp",
          "accounts": [
            {
              "name": "burnSource",
              "accounts": [
                {
                  "name": "mintRecipient",
                  "isMut": true,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "mint",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "Circle-supported mint.",
                "",
                "Token Messenger Minter program's local token account."
              ]
            },
            {
              "name": "tokenMessengerMinterSenderAuthority",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "messageTransmitterConfig",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "tokenMessenger",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "remoteTokenMessenger",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Messenger Minter program)."
              ]
            },
            {
              "name": "tokenMinter",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "CHECK Seeds must be \\[\"token_minter\"\\] (CCTP Token Messenger Minter program)."
              ]
            },
            {
              "name": "localToken",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "Local token account, which this program uses to validate the `mint` used to burn.",
                ""
              ]
            },
            {
              "name": "tokenMessengerMinterEventAuthority",
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
            }
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "sysvars",
          "accounts": [
            {
              "name": "clock",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.",
                ""
              ]
            },
            {
              "name": "rent",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.",
                ""
              ]
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "executeFastOrderLocal",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "payerSequence",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "coreMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "executeOrder",
          "accounts": [
            {
              "name": "fastVaa",
              "accounts": [
                {
                  "name": "vaa",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "activeAuction",
              "accounts": [
                {
                  "name": "auction",
                  "isMut": true,
                  "isSigner": false
                },
                {
                  "name": "custodyToken",
                  "isMut": true,
                  "isSigner": false
                },
                {
                  "name": "config",
                  "isMut": false,
                  "isSigner": false
                },
                {
                  "name": "bestOfferToken",
                  "isMut": true,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "toRouterEndpoint",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "executorToken",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "initialOfferToken",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "wormhole",
          "accounts": [
            {
              "name": "config",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "emitterSequence",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "feeCollector",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "coreBridgeProgram",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "localCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "sysvars",
          "accounts": [
            {
              "name": "clock",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.",
                ""
              ]
            },
            {
              "name": "rent",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.",
                ""
              ]
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "closeProposal",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "proposedBy",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "proposal",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "migrate",
      "accounts": [
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "custodian",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
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
      "name": "auctionConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u32"
          },
          {
            "name": "parameters",
            "type": {
              "defined": "AuctionParameters"
            }
          }
        ]
      }
    },
    {
      "name": "auction",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaaHash",
            "docs": [
              "VAA hash of the auction."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "docs": [
              "Auction status."
            ],
            "type": {
              "defined": "AuctionStatus"
            }
          },
          {
            "name": "info",
            "type": {
              "option": {
                "defined": "AuctionInfo"
              }
            }
          }
        ]
      }
    },
    {
      "name": "custodian",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "Program's owner."
            ],
            "type": "publicKey"
          },
          {
            "name": "pendingOwner",
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "paused",
            "docs": [
              "Boolean indicating whether inbound auctions are paused."
            ],
            "type": "bool"
          },
          {
            "name": "pausedSetBy",
            "type": "publicKey"
          },
          {
            "name": "ownerAssistant",
            "docs": [
              "Program's assistant."
            ],
            "type": "publicKey"
          },
          {
            "name": "feeRecipientToken",
            "type": "publicKey"
          },
          {
            "name": "auctionConfigId",
            "type": "u32"
          },
          {
            "name": "nextProposalId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "payerSequence",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "value",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "preparedOrderResponse",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "fastVaaHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "preparedBy",
            "type": "publicKey"
          },
          {
            "name": "sourceChain",
            "type": "u16"
          },
          {
            "name": "baseFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "proposal",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "action",
            "type": {
              "defined": "ProposalAction"
            }
          },
          {
            "name": "by",
            "type": "publicKey"
          },
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "slotProposedAt",
            "type": "u64"
          },
          {
            "name": "slotEnactDelay",
            "type": "u64"
          },
          {
            "name": "slotEnactedAt",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "redeemedFastFill",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaaHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "routerEndpoint",
      "docs": [
        "Foreign emitter account data."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "chain",
            "docs": [
              "Emitter chain. Cannot equal `1` (Solana's Chain ID)."
            ],
            "type": "u16"
          },
          {
            "name": "address",
            "docs": [
              "Emitter address. Cannot be zero address."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "mintRecipient",
            "docs": [
              "Future-proof field in case another network has token accounts to send assets to instead of",
              "sending to the address directly."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "protocol",
            "docs": [
              "Specific message protocol used to move assets."
            ],
            "type": {
              "defined": "MessageProtocol"
            }
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "CctpMessageArgs",
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
      "name": "AuctionParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "userPenaltyRewardBps",
            "type": "u32"
          },
          {
            "name": "initialPenaltyBps",
            "type": "u32"
          },
          {
            "name": "duration",
            "type": "u16"
          },
          {
            "name": "gracePeriod",
            "docs": [
              "* The grace period of the auction in slots. This is the number of slots the highest bidder\n     * has to execute the fast order before incurring a penalty. About 15 seconds on Avalanche.\n     * This value INCLUDES the `_auctionDuration`."
            ],
            "type": "u16"
          },
          {
            "name": "penaltyPeriod",
            "type": "u16"
          },
          {
            "name": "minOfferDeltaBps",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "AuctionInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "configId",
            "type": "u32"
          },
          {
            "name": "custodyTokenBump",
            "type": "u8"
          },
          {
            "name": "vaaSequence",
            "docs": [
              "Sequence of the fast market order VAA."
            ],
            "type": "u64"
          },
          {
            "name": "sourceChain",
            "docs": [
              "The chain where the transfer is initiated."
            ],
            "type": "u16"
          },
          {
            "name": "bestOfferToken",
            "docs": [
              "The highest bidder of the auction."
            ],
            "type": "publicKey"
          },
          {
            "name": "initialOfferToken",
            "docs": [
              "The initial bidder of the auction."
            ],
            "type": "publicKey"
          },
          {
            "name": "startSlot",
            "docs": [
              "The slot when the auction started."
            ],
            "type": "u64"
          },
          {
            "name": "amountIn",
            "docs": [
              "The amount reflecting the amount of assets transferred into the matching engine. This plus",
              "and the security deposit are used to participate in the auction."
            ],
            "type": "u64"
          },
          {
            "name": "securityDeposit",
            "docs": [
              "The additional deposit made by the highest bidder."
            ],
            "type": "u64"
          },
          {
            "name": "offerPrice",
            "docs": [
              "The offer price of the auction."
            ],
            "type": "u64"
          },
          {
            "name": "amountOut",
            "docs": [
              "The amount of tokens to be sent to the user. For CCTP fast transfers, this amount will equal",
              "the [amount_in](Self::amount_in)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "AddCctpRouterEndpointArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "chain",
            "type": "u16"
          },
          {
            "name": "cctpDomain",
            "type": "u32"
          },
          {
            "name": "address",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "mintRecipient",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "AuctionStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "NotStarted"
          },
          {
            "name": "Active"
          },
          {
            "name": "Completed",
            "fields": [
              {
                "name": "slot",
                "type": "u64"
              },
              {
                "name": "executePenalty",
                "type": {
                  "option": "u64"
                }
              }
            ]
          },
          {
            "name": "Settled",
            "fields": [
              {
                "name": "baseFee",
                "type": "u64"
              },
              {
                "name": "totalPenalty",
                "type": {
                  "option": "u64"
                }
              }
            ]
          }
        ]
      }
    },
    {
      "name": "ProposalAction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "None"
          },
          {
            "name": "UpdateAuctionParameters",
            "fields": [
              {
                "name": "id",
                "type": "u32"
              },
              {
                "name": "parameters",
                "type": {
                  "defined": "AuctionParameters"
                }
              }
            ]
          }
        ]
      }
    },
    {
      "name": "MessageProtocol",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "None"
          },
          {
            "name": "Local",
            "fields": [
              {
                "name": "programId",
                "type": "publicKey"
              }
            ]
          },
          {
            "name": "Cctp",
            "fields": [
              {
                "name": "domain",
                "docs": [
                  "CCTP domain, which is how CCTP registers identifies foreign networks."
                ],
                "type": "u32"
              }
            ]
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6002,
      "name": "OwnerOnly",
      "msg": "OwnerOnly"
    },
    {
      "code": 6004,
      "name": "OwnerOrAssistantOnly",
      "msg": "OwnerOrAssistantOnly"
    },
    {
      "code": 6008,
      "name": "CpiDisallowed",
      "msg": "CpiDisallowed"
    },
    {
      "code": 6016,
      "name": "UpgradeManagerRequired",
      "msg": "UpgradeManagerRequired"
    },
    {
      "code": 6032,
      "name": "SameEndpoint",
      "msg": "SameEndpoint"
    },
    {
      "code": 6034,
      "name": "InvalidEndpoint",
      "msg": "InvalidEndpoint"
    },
    {
      "code": 6256,
      "name": "AssistantZeroPubkey",
      "msg": "AssistantZeroPubkey"
    },
    {
      "code": 6257,
      "name": "FeeRecipientZeroPubkey",
      "msg": "FeeRecipientZeroPubkey"
    },
    {
      "code": 6258,
      "name": "ImmutableProgram",
      "msg": "ImmutableProgram"
    },
    {
      "code": 6514,
      "name": "InvalidNewOwner",
      "msg": "InvalidNewOwner"
    },
    {
      "code": 6516,
      "name": "AlreadyOwner",
      "msg": "AlreadyOwner"
    },
    {
      "code": 6518,
      "name": "NoTransferOwnershipRequest",
      "msg": "NoTransferOwnershipRequest"
    },
    {
      "code": 6520,
      "name": "InvalidNewAssistant",
      "msg": "InvalidNewAssistant"
    },
    {
      "code": 6522,
      "name": "InvalidNewFeeRecipient",
      "msg": "InvalidNewFeeRecipient"
    },
    {
      "code": 6524,
      "name": "InvalidChain",
      "msg": "InvalidChain"
    },
    {
      "code": 6526,
      "name": "NotPendingOwner",
      "msg": "NotPendingOwner"
    },
    {
      "code": 6128,
      "name": "Paused",
      "msg": "Paused"
    },
    {
      "code": 6129,
      "name": "InvalidTokenAccount",
      "msg": "InvalidTokenAccount"
    },
    {
      "code": 6130,
      "name": "ChainNotAllowed",
      "msg": "ChainNotAllowed"
    },
    {
      "code": 6131,
      "name": "InvalidMintRecipient",
      "msg": "InvalidMintRecipient"
    },
    {
      "code": 6132,
      "name": "ErrInvalidSourceRouter",
      "msg": "ErrInvalidSourceRouter"
    },
    {
      "code": 6133,
      "name": "ErrInvalidTargetRouter",
      "msg": "ErrInvalidTargetRouter"
    },
    {
      "code": 6134,
      "name": "TokenRouterProgramIdRequired",
      "msg": "TokenRouterProgramIdRequired"
    },
    {
      "code": 6135,
      "name": "InvalidAuctionDuration",
      "msg": "InvalidAuctionDuration"
    },
    {
      "code": 6136,
      "name": "InvalidAuctionGracePeriod",
      "msg": "InvalidAuctionGracePeriod"
    },
    {
      "code": 6137,
      "name": "UserPenaltyTooLarge",
      "msg": "UserPenaltyTooLarge"
    },
    {
      "code": 6138,
      "name": "InitialPenaltyTooLarge",
      "msg": "InitialPenaltyTooLarge"
    },
    {
      "code": 6139,
      "name": "MinOfferDeltaTooLarge",
      "msg": "MinOfferDeltaTooLarge"
    },
    {
      "code": 6140,
      "name": "InvalidVaa",
      "msg": "InvalidVaa"
    },
    {
      "code": 6141,
      "name": "NotFastMarketOrder",
      "msg": "NotFastMarketOrder"
    },
    {
      "code": 6142,
      "name": "FastMarketOrderExpired",
      "msg": "FastMarketOrderExpired"
    },
    {
      "code": 6143,
      "name": "OfferPriceTooHigh",
      "msg": "OfferPriceTooHigh"
    },
    {
      "code": 6144,
      "name": "AuctionAlreadyStarted",
      "msg": "AuctionAlreadyStarted"
    },
    {
      "code": 6145,
      "name": "InvalidEmitterForFastFill",
      "msg": "InvalidEmitterForFastFill"
    },
    {
      "code": 6146,
      "name": "InvalidDeposit",
      "msg": "InvalidDeposit"
    },
    {
      "code": 6147,
      "name": "InvalidDepositMessage",
      "msg": "InvalidDepositMessage"
    },
    {
      "code": 6148,
      "name": "InvalidPayloadId",
      "msg": "InvalidPayloadId"
    },
    {
      "code": 6149,
      "name": "InvalidDepositPayloadId",
      "msg": "InvalidDepositPayloadId"
    },
    {
      "code": 6150,
      "name": "AuctionNotActive",
      "msg": "AuctionNotActive"
    },
    {
      "code": 6151,
      "name": "AuctionPeriodExpired",
      "msg": "AuctionPeriodExpired"
    },
    {
      "code": 6152,
      "name": "AuctionPeriodNotExpired",
      "msg": "AuctionPeriodNotExpired"
    },
    {
      "code": 6153,
      "name": "OfferPriceNotImproved",
      "msg": "OfferPriceNotImproved"
    },
    {
      "code": 6154,
      "name": "BestOfferTokenNotPassedIn",
      "msg": "BestOfferTokenNotPassedIn"
    },
    {
      "code": 6155,
      "name": "PenaltyCalculationFailed",
      "msg": "PenaltyCalculationFailed"
    },
    {
      "code": 6156,
      "name": "VaaMismatch",
      "msg": "VaaMismatch"
    },
    {
      "code": 6157,
      "name": "MismatchedVaaHash",
      "msg": "MismatchedVaaHash"
    },
    {
      "code": 6158,
      "name": "ExecutorTokenMismatch",
      "msg": "ExecutorTokenMismatch"
    },
    {
      "code": 6159,
      "name": "InitialOfferTokenMismatch",
      "msg": "InitialOfferTokenMismatch"
    },
    {
      "code": 6160,
      "name": "FeeRecipientTokenMismatch",
      "msg": "FeeRecipientTokenMismatch"
    },
    {
      "code": 6161,
      "name": "AuctionNotCompleted",
      "msg": "AuctionNotCompleted"
    },
    {
      "code": 6162,
      "name": "AuctionConfigMismatch",
      "msg": "AuctionConfigMismatch"
    },
    {
      "code": 6163,
      "name": "EndpointDisabled",
      "msg": "EndpointDisabled"
    },
    {
      "code": 6164,
      "name": "InvalidCctpEndpoint",
      "msg": "InvalidCctpEndpoint"
    },
    {
      "code": 6165,
      "name": "CarpingNotAllowed",
      "msg": "CarpingNotAllowed"
    },
    {
      "code": 6166,
      "name": "ProposalAlreadyEnacted",
      "msg": "ProposalAlreadyEnacted"
    },
    {
      "code": 6167,
      "name": "ProposalDelayNotExpired",
      "msg": "ProposalDelayNotExpired"
    },
    {
      "code": 6168,
      "name": "InvalidProposalAction",
      "msg": "InvalidProposalAction"
    }
  ]
};

export const IDL: MatchingEngine = {
  "version": "0.0.0",
  "name": "matching_engine",
  "instructions": [
    {
      "name": "completeFastFill",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "fastFillVaa",
          "accounts": [
            {
              "name": "vaa",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "redeemedFastFill",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenRouterEmitter",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenRouterCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "routerEndpoint",
          "accounts": [
            {
              "name": "endpoint",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "localCustodyToken",
          "isMut": true,
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
      "args": []
    },
    {
      "name": "prepareOrderResponseCctp",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "fastVaa",
          "accounts": [
            {
              "name": "vaa",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "finalizedVaa",
          "accounts": [
            {
              "name": "vaa",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "preparedOrderResponse",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "preparedCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdc",
          "accounts": [
            {
              "name": "mint",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "cctp",
          "accounts": [
            {
              "name": "mintRecipient",
              "accounts": [
                {
                  "name": "mintRecipient",
                  "isMut": true,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "messageTransmitterAuthority",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "messageTransmitterConfig",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "usedNonces",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "first_nonce.to_string()\\] (CCTP Message Transmitter program)."
              ]
            },
            {
              "name": "messageTransmitterEventAuthority",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "tokenMessenger",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "remoteTokenMessenger",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Messenger Minter program)."
              ]
            },
            {
              "name": "tokenMinter",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "localToken",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "Token Messenger Minter's Local Token account. This program uses the mint of this account to",
                "validate the `mint_recipient` token account's mint.",
                ""
              ]
            },
            {
              "name": "tokenPair",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Token Messenger Minter program)."
              ]
            },
            {
              "name": "tokenMessengerMinterCustodyToken",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "tokenMessengerMinterEventAuthority",
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
            }
          ]
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
            "defined": "CctpMessageArgs"
          }
        }
      ]
    },
    {
      "name": "settleAuctionComplete",
      "accounts": [
        {
          "name": "executor",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "we will always reward the owner of the executor token account with the lamports from the",
            "prepared order response and its custody token account when we close these accounts. This",
            "means we disregard the `prepared_by` field in the prepared order response."
          ]
        },
        {
          "name": "executorToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "bestOfferToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Destination token account, which the redeemer may not own. But because the redeemer is a",
            "signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent",
            "to any account he chooses (this one).",
            ""
          ]
        },
        {
          "name": "preparedOrderResponse",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "preparedCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "auction",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "settleAuctionNoneCctp",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "payerSequence",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "coreMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "cctpMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "feeRecipientToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Destination token account, which the redeemer may not own. But because the redeemer is a",
            "signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent",
            "to any account he chooses (this one).",
            ""
          ]
        },
        {
          "name": "prepared",
          "accounts": [
            {
              "name": "by",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "orderResponse",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "custodyToken",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "fastOrderPath",
          "accounts": [
            {
              "name": "fastVaa",
              "accounts": [
                {
                  "name": "vaa",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "from",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "to",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "auction",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "There should be no account data here because an auction was never created."
          ]
        },
        {
          "name": "wormhole",
          "accounts": [
            {
              "name": "config",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "emitterSequence",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "feeCollector",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "coreBridgeProgram",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "cctp",
          "accounts": [
            {
              "name": "burnSource",
              "accounts": [
                {
                  "name": "mintRecipient",
                  "isMut": true,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "mint",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "Circle-supported mint.",
                "",
                "Token Messenger Minter program's local token account."
              ]
            },
            {
              "name": "tokenMessengerMinterSenderAuthority",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "messageTransmitterConfig",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "tokenMessenger",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "remoteTokenMessenger",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Messenger Minter program)."
              ]
            },
            {
              "name": "tokenMinter",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "CHECK Seeds must be \\[\"token_minter\"\\] (CCTP Token Messenger Minter program)."
              ]
            },
            {
              "name": "localToken",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "Local token account, which this program uses to validate the `mint` used to burn.",
                ""
              ]
            },
            {
              "name": "tokenMessengerMinterEventAuthority",
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
            }
          ]
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
          "name": "sysvars",
          "accounts": [
            {
              "name": "clock",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.",
                ""
              ]
            },
            {
              "name": "rent",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.",
                ""
              ]
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "settleAuctionNoneLocal",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "payerSequence",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "coreMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "feeRecipientToken",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Destination token account, which the redeemer may not own. But because the redeemer is a",
            "signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent",
            "to any account he chooses (this one).",
            ""
          ]
        },
        {
          "name": "prepared",
          "accounts": [
            {
              "name": "by",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "orderResponse",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "custodyToken",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "fastOrderPath",
          "accounts": [
            {
              "name": "fastVaa",
              "accounts": [
                {
                  "name": "vaa",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "from",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "to",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "auction",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "There should be no account data here because an auction was never created."
          ]
        },
        {
          "name": "wormhole",
          "accounts": [
            {
              "name": "config",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "emitterSequence",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "feeCollector",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "coreBridgeProgram",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "localCustodyToken",
          "isMut": true,
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
          "name": "sysvars",
          "accounts": [
            {
              "name": "clock",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.",
                ""
              ]
            },
            {
              "name": "rent",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.",
                ""
              ]
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "This instruction is be used to generate your program's config.",
        "And for convenience, we will store Wormhole-related PDAs in the",
        "config so we can verify these accounts with a simple == constraint."
      ],
      "accounts": [
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Owner of the program, who presumably deployed this program."
          ]
        },
        {
          "name": "custodian",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Custodian account, which saves program data useful for other",
            "instructions."
          ]
        },
        {
          "name": "auctionConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "ownerAssistant",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "TODO: do we prevent the owner from being the owner assistant?"
          ]
        },
        {
          "name": "feeRecipient",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "feeRecipientToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "cctpMintRecipient",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdc",
          "accounts": [
            {
              "name": "mint",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "programData",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "We use the program data to make sure this owner is the upgrade authority (the true owner,",
            "who deployed this program)."
          ]
        },
        {
          "name": "upgradeManagerAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "upgradeManagerProgram",
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
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "auctionParams",
          "type": {
            "defined": "AuctionParameters"
          }
        }
      ]
    },
    {
      "name": "setPause",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "ownerOrAssistant",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        }
      ],
      "args": [
        {
          "name": "pause",
          "type": "bool"
        }
      ]
    },
    {
      "name": "addCctpRouterEndpoint",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "admin",
          "accounts": [
            {
              "name": "ownerOrAssistant",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "routerEndpoint",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "localRouterEndpoint",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Local router endpoint PDA.",
            "",
            "NOTE: This account may not exist yet. But we need to pass it since it will be the owner of",
            "the local custody token account.",
            ""
          ]
        },
        {
          "name": "localCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdc",
          "accounts": [
            {
              "name": "mint",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "remoteTokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Messenger Minter program)."
          ]
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
            "defined": "AddCctpRouterEndpointArgs"
          }
        }
      ]
    },
    {
      "name": "addLocalRouterEndpoint",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "admin",
          "accounts": [
            {
              "name": "ownerOrAssistant",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "routerEndpoint",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "local",
          "accounts": [
            {
              "name": "tokenRouterProgram",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "emitter (router endpoint) address."
              ]
            },
            {
              "name": "tokenRouterEmitter",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "tokenRouterMintRecipient",
              "isMut": false,
              "isSigner": false
            }
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
      "name": "disableRouterEndpoint",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "routerEndpoint",
          "accounts": [
            {
              "name": "endpoint",
              "isMut": true,
              "isSigner": false
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "updateCctpRouterEndpoint",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "routerEndpoint",
          "accounts": [
            {
              "name": "endpoint",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "remoteTokenMessenger",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Messenger Minter program)."
          ]
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": "AddCctpRouterEndpointArgs"
          }
        }
      ]
    },
    {
      "name": "updateLocalRouterEndpoint",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "routerEndpoint",
          "accounts": [
            {
              "name": "endpoint",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "local",
          "accounts": [
            {
              "name": "tokenRouterProgram",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "emitter (router endpoint) address."
              ]
            },
            {
              "name": "tokenRouterEmitter",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "tokenRouterMintRecipient",
              "isMut": false,
              "isSigner": false
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "submitOwnershipTransferRequest",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "newOwner",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "New Owner.",
            ""
          ]
        }
      ],
      "args": []
    },
    {
      "name": "confirmOwnershipTransferRequest",
      "accounts": [
        {
          "name": "pendingOwner",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "Must be the pending owner of the program set in the [`OwnerConfig`]",
            "account."
          ]
        },
        {
          "name": "custodian",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "cancelOwnershipTransferRequest",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "proposeAuctionParameters",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "admin",
          "accounts": [
            {
              "name": "ownerOrAssistant",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "proposal",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "epochSchedule",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": "AuctionParameters"
          }
        }
      ]
    },
    {
      "name": "updateAuctionParameters",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "proposal",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "auctionConfig",
          "isMut": true,
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
      "name": "updateOwnerAssistant",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "newOwnerAssistant",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "New Assistant.",
            ""
          ]
        }
      ],
      "args": []
    },
    {
      "name": "updateFeeRecipient",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "ownerOrAssistant",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "newFeeRecipientToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "newFeeRecipient",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "New Fee Recipient.",
            ""
          ]
        }
      ],
      "args": []
    },
    {
      "name": "placeInitialOffer",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "transferAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "The auction participant needs to set approval to this PDA.",
            ""
          ]
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "auctionConfig",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "fastOrderPath",
          "accounts": [
            {
              "name": "fastVaa",
              "accounts": [
                {
                  "name": "vaa",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "from",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "to",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "auction",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "This account should only be created once, and should never be changed to",
            "init_if_needed. Otherwise someone can game an existing auction."
          ]
        },
        {
          "name": "offerToken",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the auction PDA."
          ]
        },
        {
          "name": "auctionCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdc",
          "accounts": [
            {
              "name": "mint",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "feeOffer",
          "type": "u64"
        }
      ]
    },
    {
      "name": "improveOffer",
      "accounts": [
        {
          "name": "transferAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "The auction participant needs to set approval to this PDA.",
            ""
          ]
        },
        {
          "name": "activeAuction",
          "accounts": [
            {
              "name": "auction",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "custodyToken",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "config",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "bestOfferToken",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "offerToken",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "the auction PDA."
          ]
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "feeOffer",
          "type": "u64"
        }
      ]
    },
    {
      "name": "executeFastOrderCctp",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "payerSequence",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "coreMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "cctpMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "executeOrder",
          "accounts": [
            {
              "name": "fastVaa",
              "accounts": [
                {
                  "name": "vaa",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "activeAuction",
              "accounts": [
                {
                  "name": "auction",
                  "isMut": true,
                  "isSigner": false
                },
                {
                  "name": "custodyToken",
                  "isMut": true,
                  "isSigner": false
                },
                {
                  "name": "config",
                  "isMut": false,
                  "isSigner": false
                },
                {
                  "name": "bestOfferToken",
                  "isMut": true,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "toRouterEndpoint",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "executorToken",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "initialOfferToken",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "wormhole",
          "accounts": [
            {
              "name": "config",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "emitterSequence",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "feeCollector",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "coreBridgeProgram",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "cctp",
          "accounts": [
            {
              "name": "burnSource",
              "accounts": [
                {
                  "name": "mintRecipient",
                  "isMut": true,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "mint",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "Circle-supported mint.",
                "",
                "Token Messenger Minter program's local token account."
              ]
            },
            {
              "name": "tokenMessengerMinterSenderAuthority",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "messageTransmitterConfig",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "tokenMessenger",
              "isMut": false,
              "isSigner": false
            },
            {
              "name": "remoteTokenMessenger",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Messenger Minter program)."
              ]
            },
            {
              "name": "tokenMinter",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "CHECK Seeds must be \\[\"token_minter\"\\] (CCTP Token Messenger Minter program)."
              ]
            },
            {
              "name": "localToken",
              "isMut": true,
              "isSigner": false,
              "docs": [
                "Local token account, which this program uses to validate the `mint` used to burn.",
                ""
              ]
            },
            {
              "name": "tokenMessengerMinterEventAuthority",
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
            }
          ]
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "sysvars",
          "accounts": [
            {
              "name": "clock",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.",
                ""
              ]
            },
            {
              "name": "rent",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.",
                ""
              ]
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "executeFastOrderLocal",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "payerSequence",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "coreMessage",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "custodian",
          "accounts": [
            {
              "name": "custodian",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "executeOrder",
          "accounts": [
            {
              "name": "fastVaa",
              "accounts": [
                {
                  "name": "vaa",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "activeAuction",
              "accounts": [
                {
                  "name": "auction",
                  "isMut": true,
                  "isSigner": false
                },
                {
                  "name": "custodyToken",
                  "isMut": true,
                  "isSigner": false
                },
                {
                  "name": "config",
                  "isMut": false,
                  "isSigner": false
                },
                {
                  "name": "bestOfferToken",
                  "isMut": true,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "toRouterEndpoint",
              "accounts": [
                {
                  "name": "endpoint",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            },
            {
              "name": "executorToken",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "initialOfferToken",
              "isMut": true,
              "isSigner": false
            }
          ]
        },
        {
          "name": "wormhole",
          "accounts": [
            {
              "name": "config",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "emitterSequence",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "feeCollector",
              "isMut": true,
              "isSigner": false
            },
            {
              "name": "coreBridgeProgram",
              "isMut": false,
              "isSigner": false
            }
          ]
        },
        {
          "name": "localCustodyToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "sysvars",
          "accounts": [
            {
              "name": "clock",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.",
                ""
              ]
            },
            {
              "name": "rent",
              "isMut": false,
              "isSigner": false,
              "docs": [
                "Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.",
                ""
              ]
            }
          ]
        }
      ],
      "args": []
    },
    {
      "name": "closeProposal",
      "accounts": [
        {
          "name": "admin",
          "accounts": [
            {
              "name": "owner",
              "isMut": false,
              "isSigner": true
            },
            {
              "name": "custodian",
              "accounts": [
                {
                  "name": "custodian",
                  "isMut": false,
                  "isSigner": false
                }
              ]
            }
          ]
        },
        {
          "name": "proposedBy",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "proposal",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "migrate",
      "accounts": [
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "custodian",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
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
      "name": "auctionConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u32"
          },
          {
            "name": "parameters",
            "type": {
              "defined": "AuctionParameters"
            }
          }
        ]
      }
    },
    {
      "name": "auction",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaaHash",
            "docs": [
              "VAA hash of the auction."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "docs": [
              "Auction status."
            ],
            "type": {
              "defined": "AuctionStatus"
            }
          },
          {
            "name": "info",
            "type": {
              "option": {
                "defined": "AuctionInfo"
              }
            }
          }
        ]
      }
    },
    {
      "name": "custodian",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "Program's owner."
            ],
            "type": "publicKey"
          },
          {
            "name": "pendingOwner",
            "type": {
              "option": "publicKey"
            }
          },
          {
            "name": "paused",
            "docs": [
              "Boolean indicating whether inbound auctions are paused."
            ],
            "type": "bool"
          },
          {
            "name": "pausedSetBy",
            "type": "publicKey"
          },
          {
            "name": "ownerAssistant",
            "docs": [
              "Program's assistant."
            ],
            "type": "publicKey"
          },
          {
            "name": "feeRecipientToken",
            "type": "publicKey"
          },
          {
            "name": "auctionConfigId",
            "type": "u32"
          },
          {
            "name": "nextProposalId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "payerSequence",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "value",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "preparedOrderResponse",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "fastVaaHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "preparedBy",
            "type": "publicKey"
          },
          {
            "name": "sourceChain",
            "type": "u16"
          },
          {
            "name": "baseFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "proposal",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "action",
            "type": {
              "defined": "ProposalAction"
            }
          },
          {
            "name": "by",
            "type": "publicKey"
          },
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "slotProposedAt",
            "type": "u64"
          },
          {
            "name": "slotEnactDelay",
            "type": "u64"
          },
          {
            "name": "slotEnactedAt",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "redeemedFastFill",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaaHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "routerEndpoint",
      "docs": [
        "Foreign emitter account data."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "chain",
            "docs": [
              "Emitter chain. Cannot equal `1` (Solana's Chain ID)."
            ],
            "type": "u16"
          },
          {
            "name": "address",
            "docs": [
              "Emitter address. Cannot be zero address."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "mintRecipient",
            "docs": [
              "Future-proof field in case another network has token accounts to send assets to instead of",
              "sending to the address directly."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "protocol",
            "docs": [
              "Specific message protocol used to move assets."
            ],
            "type": {
              "defined": "MessageProtocol"
            }
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "CctpMessageArgs",
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
      "name": "AuctionParameters",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "userPenaltyRewardBps",
            "type": "u32"
          },
          {
            "name": "initialPenaltyBps",
            "type": "u32"
          },
          {
            "name": "duration",
            "type": "u16"
          },
          {
            "name": "gracePeriod",
            "docs": [
              "* The grace period of the auction in slots. This is the number of slots the highest bidder\n     * has to execute the fast order before incurring a penalty. About 15 seconds on Avalanche.\n     * This value INCLUDES the `_auctionDuration`."
            ],
            "type": "u16"
          },
          {
            "name": "penaltyPeriod",
            "type": "u16"
          },
          {
            "name": "minOfferDeltaBps",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "AuctionInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "configId",
            "type": "u32"
          },
          {
            "name": "custodyTokenBump",
            "type": "u8"
          },
          {
            "name": "vaaSequence",
            "docs": [
              "Sequence of the fast market order VAA."
            ],
            "type": "u64"
          },
          {
            "name": "sourceChain",
            "docs": [
              "The chain where the transfer is initiated."
            ],
            "type": "u16"
          },
          {
            "name": "bestOfferToken",
            "docs": [
              "The highest bidder of the auction."
            ],
            "type": "publicKey"
          },
          {
            "name": "initialOfferToken",
            "docs": [
              "The initial bidder of the auction."
            ],
            "type": "publicKey"
          },
          {
            "name": "startSlot",
            "docs": [
              "The slot when the auction started."
            ],
            "type": "u64"
          },
          {
            "name": "amountIn",
            "docs": [
              "The amount reflecting the amount of assets transferred into the matching engine. This plus",
              "and the security deposit are used to participate in the auction."
            ],
            "type": "u64"
          },
          {
            "name": "securityDeposit",
            "docs": [
              "The additional deposit made by the highest bidder."
            ],
            "type": "u64"
          },
          {
            "name": "offerPrice",
            "docs": [
              "The offer price of the auction."
            ],
            "type": "u64"
          },
          {
            "name": "amountOut",
            "docs": [
              "The amount of tokens to be sent to the user. For CCTP fast transfers, this amount will equal",
              "the [amount_in](Self::amount_in)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "AddCctpRouterEndpointArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "chain",
            "type": "u16"
          },
          {
            "name": "cctpDomain",
            "type": "u32"
          },
          {
            "name": "address",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "mintRecipient",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "AuctionStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "NotStarted"
          },
          {
            "name": "Active"
          },
          {
            "name": "Completed",
            "fields": [
              {
                "name": "slot",
                "type": "u64"
              },
              {
                "name": "executePenalty",
                "type": {
                  "option": "u64"
                }
              }
            ]
          },
          {
            "name": "Settled",
            "fields": [
              {
                "name": "baseFee",
                "type": "u64"
              },
              {
                "name": "totalPenalty",
                "type": {
                  "option": "u64"
                }
              }
            ]
          }
        ]
      }
    },
    {
      "name": "ProposalAction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "None"
          },
          {
            "name": "UpdateAuctionParameters",
            "fields": [
              {
                "name": "id",
                "type": "u32"
              },
              {
                "name": "parameters",
                "type": {
                  "defined": "AuctionParameters"
                }
              }
            ]
          }
        ]
      }
    },
    {
      "name": "MessageProtocol",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "None"
          },
          {
            "name": "Local",
            "fields": [
              {
                "name": "programId",
                "type": "publicKey"
              }
            ]
          },
          {
            "name": "Cctp",
            "fields": [
              {
                "name": "domain",
                "docs": [
                  "CCTP domain, which is how CCTP registers identifies foreign networks."
                ],
                "type": "u32"
              }
            ]
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6002,
      "name": "OwnerOnly",
      "msg": "OwnerOnly"
    },
    {
      "code": 6004,
      "name": "OwnerOrAssistantOnly",
      "msg": "OwnerOrAssistantOnly"
    },
    {
      "code": 6008,
      "name": "CpiDisallowed",
      "msg": "CpiDisallowed"
    },
    {
      "code": 6016,
      "name": "UpgradeManagerRequired",
      "msg": "UpgradeManagerRequired"
    },
    {
      "code": 6032,
      "name": "SameEndpoint",
      "msg": "SameEndpoint"
    },
    {
      "code": 6034,
      "name": "InvalidEndpoint",
      "msg": "InvalidEndpoint"
    },
    {
      "code": 6256,
      "name": "AssistantZeroPubkey",
      "msg": "AssistantZeroPubkey"
    },
    {
      "code": 6257,
      "name": "FeeRecipientZeroPubkey",
      "msg": "FeeRecipientZeroPubkey"
    },
    {
      "code": 6258,
      "name": "ImmutableProgram",
      "msg": "ImmutableProgram"
    },
    {
      "code": 6514,
      "name": "InvalidNewOwner",
      "msg": "InvalidNewOwner"
    },
    {
      "code": 6516,
      "name": "AlreadyOwner",
      "msg": "AlreadyOwner"
    },
    {
      "code": 6518,
      "name": "NoTransferOwnershipRequest",
      "msg": "NoTransferOwnershipRequest"
    },
    {
      "code": 6520,
      "name": "InvalidNewAssistant",
      "msg": "InvalidNewAssistant"
    },
    {
      "code": 6522,
      "name": "InvalidNewFeeRecipient",
      "msg": "InvalidNewFeeRecipient"
    },
    {
      "code": 6524,
      "name": "InvalidChain",
      "msg": "InvalidChain"
    },
    {
      "code": 6526,
      "name": "NotPendingOwner",
      "msg": "NotPendingOwner"
    },
    {
      "code": 6128,
      "name": "Paused",
      "msg": "Paused"
    },
    {
      "code": 6129,
      "name": "InvalidTokenAccount",
      "msg": "InvalidTokenAccount"
    },
    {
      "code": 6130,
      "name": "ChainNotAllowed",
      "msg": "ChainNotAllowed"
    },
    {
      "code": 6131,
      "name": "InvalidMintRecipient",
      "msg": "InvalidMintRecipient"
    },
    {
      "code": 6132,
      "name": "ErrInvalidSourceRouter",
      "msg": "ErrInvalidSourceRouter"
    },
    {
      "code": 6133,
      "name": "ErrInvalidTargetRouter",
      "msg": "ErrInvalidTargetRouter"
    },
    {
      "code": 6134,
      "name": "TokenRouterProgramIdRequired",
      "msg": "TokenRouterProgramIdRequired"
    },
    {
      "code": 6135,
      "name": "InvalidAuctionDuration",
      "msg": "InvalidAuctionDuration"
    },
    {
      "code": 6136,
      "name": "InvalidAuctionGracePeriod",
      "msg": "InvalidAuctionGracePeriod"
    },
    {
      "code": 6137,
      "name": "UserPenaltyTooLarge",
      "msg": "UserPenaltyTooLarge"
    },
    {
      "code": 6138,
      "name": "InitialPenaltyTooLarge",
      "msg": "InitialPenaltyTooLarge"
    },
    {
      "code": 6139,
      "name": "MinOfferDeltaTooLarge",
      "msg": "MinOfferDeltaTooLarge"
    },
    {
      "code": 6140,
      "name": "InvalidVaa",
      "msg": "InvalidVaa"
    },
    {
      "code": 6141,
      "name": "NotFastMarketOrder",
      "msg": "NotFastMarketOrder"
    },
    {
      "code": 6142,
      "name": "FastMarketOrderExpired",
      "msg": "FastMarketOrderExpired"
    },
    {
      "code": 6143,
      "name": "OfferPriceTooHigh",
      "msg": "OfferPriceTooHigh"
    },
    {
      "code": 6144,
      "name": "AuctionAlreadyStarted",
      "msg": "AuctionAlreadyStarted"
    },
    {
      "code": 6145,
      "name": "InvalidEmitterForFastFill",
      "msg": "InvalidEmitterForFastFill"
    },
    {
      "code": 6146,
      "name": "InvalidDeposit",
      "msg": "InvalidDeposit"
    },
    {
      "code": 6147,
      "name": "InvalidDepositMessage",
      "msg": "InvalidDepositMessage"
    },
    {
      "code": 6148,
      "name": "InvalidPayloadId",
      "msg": "InvalidPayloadId"
    },
    {
      "code": 6149,
      "name": "InvalidDepositPayloadId",
      "msg": "InvalidDepositPayloadId"
    },
    {
      "code": 6150,
      "name": "AuctionNotActive",
      "msg": "AuctionNotActive"
    },
    {
      "code": 6151,
      "name": "AuctionPeriodExpired",
      "msg": "AuctionPeriodExpired"
    },
    {
      "code": 6152,
      "name": "AuctionPeriodNotExpired",
      "msg": "AuctionPeriodNotExpired"
    },
    {
      "code": 6153,
      "name": "OfferPriceNotImproved",
      "msg": "OfferPriceNotImproved"
    },
    {
      "code": 6154,
      "name": "BestOfferTokenNotPassedIn",
      "msg": "BestOfferTokenNotPassedIn"
    },
    {
      "code": 6155,
      "name": "PenaltyCalculationFailed",
      "msg": "PenaltyCalculationFailed"
    },
    {
      "code": 6156,
      "name": "VaaMismatch",
      "msg": "VaaMismatch"
    },
    {
      "code": 6157,
      "name": "MismatchedVaaHash",
      "msg": "MismatchedVaaHash"
    },
    {
      "code": 6158,
      "name": "ExecutorTokenMismatch",
      "msg": "ExecutorTokenMismatch"
    },
    {
      "code": 6159,
      "name": "InitialOfferTokenMismatch",
      "msg": "InitialOfferTokenMismatch"
    },
    {
      "code": 6160,
      "name": "FeeRecipientTokenMismatch",
      "msg": "FeeRecipientTokenMismatch"
    },
    {
      "code": 6161,
      "name": "AuctionNotCompleted",
      "msg": "AuctionNotCompleted"
    },
    {
      "code": 6162,
      "name": "AuctionConfigMismatch",
      "msg": "AuctionConfigMismatch"
    },
    {
      "code": 6163,
      "name": "EndpointDisabled",
      "msg": "EndpointDisabled"
    },
    {
      "code": 6164,
      "name": "InvalidCctpEndpoint",
      "msg": "InvalidCctpEndpoint"
    },
    {
      "code": 6165,
      "name": "CarpingNotAllowed",
      "msg": "CarpingNotAllowed"
    },
    {
      "code": 6166,
      "name": "ProposalAlreadyEnacted",
      "msg": "ProposalAlreadyEnacted"
    },
    {
      "code": 6167,
      "name": "ProposalDelayNotExpired",
      "msg": "ProposalDelayNotExpired"
    },
    {
      "code": 6168,
      "name": "InvalidProposalAction",
      "msg": "InvalidProposalAction"
    }
  ]
};
