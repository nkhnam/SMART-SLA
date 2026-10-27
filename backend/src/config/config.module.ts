import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "./env.schema.js";

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment })]
})
export class AppConfigModule {}
