import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("SLAContractModule", (m) => {
  const sla = m.contract("SLAContract");
  return { sla };
});