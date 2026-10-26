export const agreementRegistryAbi = [
  {
    type: "function",
    name: "registerAgreement",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "approval",
        type: "tuple",
        components: [
          { name: "agreementKey", type: "bytes32" },
          { name: "agreementHash", type: "bytes32" },
          { name: "version", type: "uint64" },
          { name: "buyerOrganization", type: "bytes32" },
          { name: "supplierOrganization", type: "bytes32" },
          { name: "buyerSigner", type: "address" },
          { name: "supplierSigner", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint64" }
        ]
      },
      { name: "buyerSignature", type: "bytes" },
      { name: "supplierSignature", type: "bytes" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "getAgreement",
    stateMutability: "view",
    inputs: [{ name: "agreementKey", type: "bytes32" }],
    outputs: [
      {
        name: "agreement",
        type: "tuple",
        components: [
          { name: "agreementHash", type: "bytes32" },
          { name: "version", type: "uint64" },
          { name: "buyerOrganization", type: "bytes32" },
          { name: "supplierOrganization", type: "bytes32" },
          { name: "validUntil", type: "uint64" },
          { name: "registeredAt", type: "uint64" }
        ]
      }
    ]
  },
  {
    type: "event",
    name: "AgreementRegistered",
    anonymous: false,
    inputs: [
      { indexed: true, name: "agreementKey", type: "bytes32" },
      { indexed: true, name: "agreementHash", type: "bytes32" },
      { indexed: false, name: "version", type: "uint64" },
      { indexed: false, name: "buyerOrganization", type: "bytes32" },
      { indexed: false, name: "supplierOrganization", type: "bytes32" },
      { indexed: false, name: "validUntil", type: "uint64" }
    ]
  }
] as const;
