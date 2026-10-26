import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import type { AppEnvironment } from "./env.schema.js";

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService<AppEnvironment, true>);
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.enableCors({
    origin: config.getOrThrow("CORS_ORIGINS", { infer: true }),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Organization-Id", "X-SLA-CSRF"]
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true
  }));

  const openApiConfig = new DocumentBuilder()
    .setTitle("SLA-DEX API")
    .setDescription("Phase 2A identity, organization, and draft agreement API.")
    .setVersion("1.0")
    .addCookieAuth("sladex_session", { type: "apiKey", in: "cookie" })
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, openApiConfig));
}
