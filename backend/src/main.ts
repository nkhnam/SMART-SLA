import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  // Render đứng sau proxy -> tin header X-Forwarded-For để lấy đúng IP người dùng (dùng cho giới hạn đăng nhập)
  app.set('trust proxy', 1);

  // CORS: chỉ cho phép các domain frontend trong CORS_ORIGINS (cách nhau bởi dấu phẩy)
  // VD: CORS_ORIGINS=https://smart-sla.vercel.app,http://localhost:3000
  const allowed = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (allowed.length === 0) {
    // Chưa cấu hình -> tạm cho phép tất cả để web không bị hỏng, nhưng cảnh báo
    logger.warn('Chưa đặt CORS_ORIGINS -> đang cho phép MỌI domain gọi API');
    app.enableCors();
  } else {
    app.enableCors({
      origin: (origin, callback) => {
        // Không có origin = gọi từ server (webhook Datadog, Oracle, Postman...) -> CORS không áp dụng
        if (!origin || allowed.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS: domain ${origin} không được phép`), false);
      },
      credentials: true,
    });
    logger.log(`CORS chỉ cho phép: ${allowed.join(', ')}`);
  }

  // Render cấp PORT qua biến môi trường, phải lắng nghe đúng cổng đó
  // Frontend dùng cổng 3000/3001 ở local, nên API mặc định chạy riêng trên 3002.
  const port = process.env.PORT || 3002;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
