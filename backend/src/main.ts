import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import express from "express";
import type { Request } from "express";
import type { AppEnvironment } from "./config/env.schema.js";
import { configureApplication } from "./config/configure-app.js";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(express.json({ limit: "64kb", verify: (request, _response, buffer) => { (request as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
  app.use(express.urlencoded({ extended: true, limit: "64kb" }));
  const config = app.get(ConfigService<AppEnvironment, true>);
  configureApplication(app);
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow("PORT", { infer: true }), "0.0.0.0");
}

void bootstrap();
