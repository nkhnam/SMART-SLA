import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, Matches } from "class-validator";

export class CreateSignerChallengeDto {
  @ApiProperty({ example: "0x0000000000000000000000000000000000000001" })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/)
  address!: string;
}

export class VerifySignerChallengeDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ description: "65-byte EOA EIP-712 signature" })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{130}$/)
  signature!: `0x${string}`;
}
