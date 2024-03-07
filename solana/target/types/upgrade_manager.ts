export type UpgradeManager = {
  "version": "0.0.0",
  "name": "upgrade_manager",
  "instructions": [
    {
      "name": "upgradeMatchingEngine",
      "accounts": [
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Owner of this program. Must match the upgrade authority in this program data."
          ]
        },
        {
          "name": "programData",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Program data for this program. Its upgrade authority must match the owner."
          ]
        },
        {
          "name": "upgradeAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Engine). This address must equal the liquidity layer program data's upgrade authority."
          ]
        },
        {
          "name": "matchingEngineBuffer",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Deployed implementation of liquidity layer.",
            ""
          ]
        },
        {
          "name": "matchingEngineProgramData",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "matchingEngineProgram",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "because we cannot set this account to be mutable in that case."
          ]
        },
        {
          "name": "bpfLoaderUpgradeableProgram",
          "isMut": false,
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
        }
      ],
      "args": []
    },
    {
      "name": "executeTokenRouterUpgrade",
      "accounts": [
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Owner of this program. Must match the upgrade authority in this program data."
          ]
        },
        {
          "name": "upgradeAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Engine). This address must equal the liquidity layer program data's upgrade authority."
          ]
        },
        {
          "name": "upgradeReceipt",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenRouterBuffer",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Deployed implementation of liquidity layer.",
            ""
          ]
        },
        {
          "name": "tokenRouterProgramData",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenRouterCustodian",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenRouterProgram",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "because we cannot set this account to be mutable in that case."
          ]
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
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "upgradeReceipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "buffer",
            "type": "publicKey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    }
  ]
};

export const IDL: UpgradeManager = {
  "version": "0.0.0",
  "name": "upgrade_manager",
  "instructions": [
    {
      "name": "upgradeMatchingEngine",
      "accounts": [
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Owner of this program. Must match the upgrade authority in this program data."
          ]
        },
        {
          "name": "programData",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Program data for this program. Its upgrade authority must match the owner."
          ]
        },
        {
          "name": "upgradeAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Engine). This address must equal the liquidity layer program data's upgrade authority."
          ]
        },
        {
          "name": "matchingEngineBuffer",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Deployed implementation of liquidity layer.",
            ""
          ]
        },
        {
          "name": "matchingEngineProgramData",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "matchingEngineProgram",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "because we cannot set this account to be mutable in that case."
          ]
        },
        {
          "name": "bpfLoaderUpgradeableProgram",
          "isMut": false,
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
        }
      ],
      "args": []
    },
    {
      "name": "executeTokenRouterUpgrade",
      "accounts": [
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Owner of this program. Must match the upgrade authority in this program data."
          ]
        },
        {
          "name": "upgradeAuthority",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "Engine). This address must equal the liquidity layer program data's upgrade authority."
          ]
        },
        {
          "name": "upgradeReceipt",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenRouterBuffer",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Deployed implementation of liquidity layer.",
            ""
          ]
        },
        {
          "name": "tokenRouterProgramData",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenRouterCustodian",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenRouterProgram",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "because we cannot set this account to be mutable in that case."
          ]
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
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "clock",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "upgradeReceipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "buffer",
            "type": "publicKey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
