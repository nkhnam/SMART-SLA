import { IsBoolean, IsEnum, IsISO8601, IsInt, IsObject, IsOptional, IsString, IsUrl, Max, MaxLength, Min, Matches, ValidateIf } from "class-validator";
import { Type } from "class-transformer";
import { MonitoringSourceType } from "../generated/prisma/client.js";

export class CreateMonitoringSourceDto {
  @IsEnum(MonitoringSourceType)
  type!: MonitoringSourceType;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(2048)
  endpointUrl?: string;

  @IsInt()
  @Min(60)
  @Max(3600)
  intervalSeconds!: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(365)
  retentionDays?: number;
}

export class UpdateMonitoringSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(2048)
  endpointUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(3600)
  intervalSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(365)
  retentionDays?: number;

  @ValidateIf((_input: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  rotateWebhookSecret?: boolean;
}

export class MonitoringObservationQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Matches(/^[0-9a-f-]{36}$/i)
  sourceId?: string;
}

export class EvaluateMonitoringKpisDto {
  @IsISO8601()
  windowStart!: string;

  @IsISO8601()
  windowEnd!: string;

  @IsOptional()
  @Matches(/^[0-9a-f-]{36}$/i)
  sourceId?: string;
}

export class BuildEvidenceDto {
  @IsISO8601()
  windowStart!: string;

  @IsISO8601()
  windowEnd!: string;
}

export class WebhookObservationDto {
  @IsISO8601()
  observedAt!: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(599)
  httpStatus?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  latencyMs?: number;

  @IsBoolean()
  reachable!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  collectionRegion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  agentIdentity?: string;

  @IsOptional()
  @IsObject()
  providerMetadata?: Record<string, unknown>;
}
