import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "./env.schema.js";

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: process.env.LOCAL_SAFE_MODE === "true", validate: validateEnvironment })]
})
export class AppConfigModule {}
