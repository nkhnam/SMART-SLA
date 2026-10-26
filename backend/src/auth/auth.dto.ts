import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsEnum, IsString, Length, Matches, MaxLength, MinLength } from "class-validator";
import { OrganizationType } from "../generated/prisma/client.js";

export class RegisterDto {
  @ApiProperty({ example: "alex@example.com" })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: "Alex Morgan", maxLength: 120 })
  @IsString()
  @Length(1, 120)
  @Matches(/\S/)
  displayName!: string;

  @ApiProperty({ example: "Northstar Cloud", maxLength: 160 })
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  organizationName!: string;

  @ApiProperty({ enum: OrganizationType })
  @IsEnum(OrganizationType)
  organizationType!: OrganizationType;
}

export class LoginDto {
  @ApiProperty({ example: "alex@example.com" })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
