import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class CreateAgreementInvitationDto {
  @ApiProperty({ format: "uuid", description: "Existing registered counterparty organization ID" })
  @IsUUID()
  organizationId!: string;
}
