import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ConfigureIxcDto } from './dto/configure-ixc.dto';
import { AttemptIdentityVerificationDto } from './dto/attempt-identity-verification.dto';
import { IxcCustomerIdParams } from './dto/ixc-customer-id.params';
import { IxcProtectedQuery } from './dto/ixc-protected-query';
import { SearchIxcCustomerQuery } from './dto/search-ixc-customer.query';
import { IxcService } from './ixc.service';
import { IxcInmapCoverageDto } from './dto/ixc-inmap-coverage.dto';
import { IxcAutoViabilityCheckDto } from './dto/ixc-auto-viability-check.dto';
import { IxcInmapCoverageService } from './ixc-inmap-coverage.service';
import { IntegrationGovernanceService } from '../integration-governance/integration-governance.service';

@Controller('integrations/ixc')
export class IxcController {
  constructor(
    private readonly ixc: IxcService,
    private readonly governance: IntegrationGovernanceService,
    private readonly inmapCoverage: IxcInmapCoverageService,
  ) {}

  /** Contrato de capacidade; não expõe configuração nem credenciais. */
  @Roles('ADMIN', 'SUPERVISOR')
  @Get('mcp/capabilities')
  mcpCapabilities() {
    return {
      mode: 'GOVERNED_DIRECT' as const,
      ...this.governance.profile('IXC'),
      resultContract: ['CONFIRMED', 'NOT_FOUND', 'UNAVAILABLE', 'AMBIGUOUS'] as const,
    };
  }

  @Roles('ADMIN')
  @Get()
  configuration() {
    return this.ixc.getConfiguration();
  }

  @Roles('ADMIN')
  @Put()
  configure(@Body() dto: ConfigureIxcDto) {
    return this.ixc.configure(dto);
  }

  @Roles('ADMIN')
  @Post('test')
  @HttpCode(HttpStatus.OK)
  test() {
    return this.ixc.test();
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('conversations/:conversationId/identity/attempt')
  @HttpCode(HttpStatus.OK)
  attemptIdentity(
    @Param('conversationId') conversationId: string,
    @Body() dto: AttemptIdentityVerificationDto,
  ) {
    return this.ixc.attemptIdentityVerification(conversationId, dto);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post('conversations/:conversationId/identity/unlock')
  @HttpCode(HttpStatus.OK)
  unlockIdentity(@Param('conversationId') conversationId: string) {
    return this.ixc.unlockIdentityVerification(conversationId);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('customers/search')
  search(@Query() query: SearchIxcCustomerQuery) {
    return this.ixc.searchCustomers(query);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('customers/:customerId/contracts')
  contracts(@Param() params: IxcCustomerIdParams, @Query() query: IxcProtectedQuery) {
    return this.ixc.listContracts(params.customerId, query.conversationId);
  }

  /** Dados financeiros permanecem restritos enquanto a identidade não é homologada. */
  @Roles('ADMIN', 'SUPERVISOR')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('customers/:customerId/invoices')
  invoices(@Param() params: IxcCustomerIdParams, @Query() query: IxcProtectedQuery) {
    return this.ixc.listInvoices(params.customerId, query.conversationId);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('customers/:customerId/service-orders')
  serviceOrders(@Param() params: IxcCustomerIdParams, @Query() query: IxcProtectedQuery) {
    return this.ixc.listServiceOrders(params.customerId, query.conversationId);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('customers/:customerId/connections')
  connections(@Param() params: IxcCustomerIdParams, @Query() query: IxcProtectedQuery) {
    return this.ixc.listConnections(params.customerId, query.conversationId);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('customers/:customerId/tickets')
  tickets(@Param() params: IxcCustomerIdParams, @Query() query: IxcProtectedQuery) {
    return this.ixc.listTickets(params.customerId, query.conversationId);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Get('catalog/subjects')
  subjects() {
    return this.ixc.listSubjectRules();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Get('catalog/plans')
  plans() {
    return this.ixc.listPlans();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Get('catalog/speed-profiles')
  speedProfiles() {
    return this.ixc.listSpeedProfiles();
  }

  /**
   * Evidência técnica de caixas próximas, visível apenas ao administrativo.
   * Não substitui a Auto Viabilidade do InMap nem retorna topologia/endereço.
   */
  @Roles('ADMIN')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('inmap/coverage-evidence')
  @HttpCode(HttpStatus.OK)
  inmapCoverageEvidence(@Body() dto: IxcInmapCoverageDto) {
    return this.inmapCoverage.collect(dto);
  }

  /** Prontidão da configuração oficial; não expõe geometria nem confirma cobertura. */
  @Roles('ADMIN')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('inmap/viability-configuration')
  inmapViabilityConfiguration() {
    return this.inmapCoverage.inspectOfficialConfiguration();
  }

  /** Motor oficial V3, leitura administrativa e sem dados de cliente. */
  @Roles('ADMIN')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('inmap/auto-viability/runtime-configuration')
  inmapAutoViabilityRuntimeConfiguration() {
    return this.ixc.readAutoViabilityRuntimeConfiguration();
  }

  /** Consulta técnica oficial, protegida contra duplicidade e sem prospecção. */
  @Roles('ADMIN')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('inmap/auto-viability/check')
  @HttpCode(HttpStatus.OK)
  inmapAutoViabilityCheck(@Body() dto: IxcAutoViabilityCheckDto) {
    return this.ixc.checkAutoViability(dto);
  }
}
