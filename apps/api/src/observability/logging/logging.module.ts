import { Module } from '@nestjs/common';
import { AppLogger } from './app-logger.service';

/**
 * LoggingModule (CONTRACTS §14): expõe o AppLogger para `app.useLogger()` em
 * main.ts. `ConfigService` (global) e `TenancyService` (TenancyModule,
 * importado no AppModule) já estão disponíveis no container — nada a
 * importar aqui.
 */
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggingModule {}
