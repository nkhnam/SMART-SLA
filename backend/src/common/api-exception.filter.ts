import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import type { Request, Response } from "express";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = typeof rawResponse === "string"
      ? rawResponse
      : typeof rawResponse === "object" && rawResponse !== null && "message" in rawResponse
        ? (rawResponse as { message: unknown }).message
        : status >= 500 ? "The request could not be completed." : "The request is invalid.";

    response.status(status).json({
      error: {
        code: exception instanceof HttpException ? exception.name : "InternalServerError",
        message
      },
      path: request.path,
      timestamp: new Date().toISOString()
    });
  }
}
