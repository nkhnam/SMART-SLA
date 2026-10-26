import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.38",
        path: resolve(process.cwd(), "node_modules/solc/soljson.js"),
        settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } }
      }
    }
  },
  networks: {
    hardhatMainnet: { type: "edr-simulated", chainType: "l1" },
    avalancheFuji: {
      type: "http",
      chainType: "l1",
      chainId: 43113,
      url: configVariable("AVALANCHE_FUJI_RPC_URL"),
      accounts: [configVariable("AVALANCHE_FUJI_DEPLOYER_PRIVATE_KEY")]
    }
  }
});
