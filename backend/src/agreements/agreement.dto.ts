import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";

export class AgreementTermsDto {
  @ApiProperty({ example: 99.95, minimum: 0.01, maximum: 100 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  uptimeTargetPercent!: number;

  @ApiProperty({ example: 180, minimum: 1, maximum: 600000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600000)
  responseTimeTargetMs!: number;

  @ApiProperty({ example: 24, minimum: 1, maximum: 8760 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  measurementWindowHours!: number;

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 300, { each: true })
  @Matches(/\S/, { each: true })
  exclusions?: string[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreateAgreementDto {
  @ApiProperty({ example: "Managed cloud operations", maxLength: 160 })
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  name!: string;

  @ApiProperty({ example: "Managed Kubernetes and database hosting", maxLength: 4000 })
  @IsString()
  @Length(1, 4000)
  @Matches(/\S/)
  serviceDescription!: string;

  @ApiProperty({ example: "Northstar Cloud", maxLength: 160 })
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  counterpartyDisplayName!: string;

  @ApiProperty({ type: AgreementTermsDto })
  @ValidateNested()
  @Type(() => AgreementTermsDto)
  terms!: AgreementTermsDto;
}

export class UpdateAgreementDto extends CreateAgreementDto {
  @ApiProperty({ description: "Version last read by the editor", minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class AgreementListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: ["createdAt", "updatedAt"], default: "updatedAt" })
  @IsOptional()
  @IsIn(["createdAt", "updatedAt"])
  sort: "createdAt" | "updatedAt" = "updatedAt";

  @ApiPropertyOptional({ enum: ["asc", "desc"], default: "desc" })
  @IsOptional()
  @IsIn(["asc", "desc"])
  order: "asc" | "desc" = "desc";

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  createdAfter?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  createdBefore?: string;
}
