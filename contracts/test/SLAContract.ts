import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

// Tua nhanh thời gian trên blockchain local
async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("SLAContract", function () {
  const slaHash = ethers.id("SLA-001: Uptime 99.9%");
  const evidenceHash = ethers.id("EVIDENCE-001: Uptime 98.7% thang 9");
  const WINDOW = 120; // 2 phút (demo); chạy thật: 48-72 giờ

  async function deploy() {
    const [operator, stranger] = await ethers.getSigners();
    const sla = await ethers.deployContract("SLAContract");
    return { sla, operator, stranger };
  }

  it("Ghi hash SLA lên chain", async function () {
    const { sla } = await deploy();
    await expect(sla.registerSLA(slaHash)).to.emit(sla, "SLARegistered");
    expect(await sla.slaRegisteredAt(slaHash)).to.be.greaterThan(0n);
  });

  it("Chặn ví lạ (không phải backend) ghi dữ liệu", async function () {
    const { sla, stranger } = await deploy();
    await expect(sla.connect(stranger).registerSLA(slaHash))
      .to.be.revertedWithCustomError(sla, "NotOperator");
  });

  it("Ghi vi phạm -> mở Challenge Window -> bị phản đối", async function () {
    const { sla } = await deploy();
    await sla.registerSLA(slaHash);
    await expect(sla.recordViolation(evidenceHash, slaHash, 500, WINDOW))
      .to.emit(sla, "ViolationRecorded");
    await expect(sla.challenge(evidenceHash)).to.emit(sla, "Challenged");
    expect((await sla.evidences(evidenceHash)).status).to.equal(2n); // Challenged
  });

  it("Không cho chốt khi Challenge Window còn mở", async function () {
    const { sla } = await deploy();
    await sla.registerSLA(slaHash);
    await sla.recordViolation(evidenceHash, slaHash, 500, WINDOW);
    await expect(sla.settle(evidenceHash))
      .to.be.revertedWithCustomError(sla, "WindowOpen");
  });

  it("Hết hạn không ai phản đối -> tự động chốt (Settled)", async function () {
    const { sla } = await deploy();
    await sla.registerSLA(slaHash);
    await sla.recordViolation(evidenceHash, slaHash, 500, WINDOW);
    await increaseTime(WINDOW + 1);
    await expect(sla.settle(evidenceHash)).to.emit(sla, "Settled");
    expect((await sla.evidences(evidenceHash)).status).to.equal(3n); // Settled
  });

  it("Không cho phản đối sau khi hết hạn", async function () {
    const { sla } = await deploy();
    await sla.registerSLA(slaHash);
    await sla.recordViolation(evidenceHash, slaHash, 500, WINDOW);
    await increaseTime(WINDOW + 1);
    await expect(sla.challenge(evidenceHash))
      .to.be.revertedWithCustomError(sla, "WindowClosed");
  });
});