import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { TenancyService } from '../tenancy/tenancy.service';
import { applyTenantScope, isTenantModel } from './tenant-scope';

function createTenantClient(base: PrismaClient, tenancy: TenancyService) {
  return base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!isTenantModel(model)) {
            return query(args);
          }
          const orgId = tenancy.getOrgId();
          if (!orgId) {
            throw new Error(
              `Contexto de tenant ausente para ${model}.${operation}. ` +
                'Rotas públicas/webhooks/seed devem usar prismaSystem explicitamente.',
            );
          }
          const scoped = applyTenantScope(operation, args as Record<string, unknown>, orgId);
          return query(scoped as typeof args);
        },
      },
    },
  });
}

/**
 * Client tenant SEM os métodos raw: a extension só intercepta operações de
 * modelo, então `$queryRaw`/`$executeRaw` passariam SEM filtro de org_id com
 * aparência de escopados. Raw SQL é sempre via `prismaSystem` com filtro
 * manual de org_id — o call site é obrigado a nomear a intenção.
 */
export type TenantPrismaClient = Omit<
  ReturnType<typeof createTenantClient>,
  '$queryRaw' | '$queryRawUnsafe' | '$executeRaw' | '$executeRawUnsafe' | '$runCommandRaw'
>;

/**
 * PrismaService (CONTRACTS §9):
 * - `tenant`: client com extension que injeta `orgId` automaticamente em
 *   where/create/update/delete/upsert/count/aggregate de TODOS os modelos tenant.
 * - `prismaSystem`: client cru, SEM escopo — uso explícito em webhooks, auth e seed.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly tenant: TenantPrismaClient;
  private readonly isProduction: boolean;

  constructor(config: ConfigService<Env, true>, tenancy: TenancyService) {
    super({
      datasources: { db: { url: config.get('DATABASE_URL', { infer: true }) } },
    });
    this.isProduction = config.get('NODE_ENV', { infer: true }) === 'production';
    this.tenant = createTenantClient(this, tenancy);
  }

  /** Acesso sem escopo de tenant — SEMPRE nomeie a intenção no call site. */
  get prismaSystem(): PrismaClient {
    return this;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      if (this.isProduction) {
        throw error;
      }
      this.logger.warn(
        `Banco indisponível no boot (dev): ${(error as Error).message}. Conexão será retentada por query.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
