import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, Matches } from "class-validator";

export class SelectAgreementSignerDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  authorizedSignerId!: string;
}

export class SubmitAgreementSignatureDto {
  @ApiProperty({ description: "65-byte EOA EIP-712 signature" })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{130}$/)
  signature!: `0x${string}`;
}
