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
  if (process.env.LOCAL_SAFE_MODE === "true" && process.send) {
    process.once("disconnect", () => { void app.close().finally(() => process.exit(0)); });
    if (!process.connected) { await app.close(); return; }
  }
  app.use(express.json({ limit: "64kb", verify: (request, _response, buffer) => { (request as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
  app.use(express.urlencoded({ extended: true, limit: "64kb" }));
  const config = app.get(ConfigService<AppEnvironment, true>);
  configureApplication(app);
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow("PORT", { infer: true }), config.getOrThrow("HOST", { infer: true }));
  if (process.env.LOCAL_SAFE_MODE === "true" && process.send) {
    const address = app.getHttpServer().address();
    process.send({ type: "local-ready", host: address.address, port: address.port, workersEnabled: config.getOrThrow("WORKERS_ENABLED", { infer: true }) });
  }
}

void bootstrap();
