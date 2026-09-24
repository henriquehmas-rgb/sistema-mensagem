import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ConfigureOlhoDeDeusDto } from './dto/configure-olho-de-deus.dto';
import {
  ConfirmNetworkTopologyMappingDto,
  CreateNetworkTopologyMappingDto,
} from './dto/create-network-topology-mapping.dto';
import { RecordNetworkTopologyCalibrationDto } from './dto/record-network-topology-calibration.dto';
import { OlhoDeDeusConfigurationService } from './olho-de-deus-configuration.service';
import { NormalizeNetworkEventDto } from './dto/normalize-network-event.dto';
import { SimulateNetworkContextDto } from './dto/simulate-network-context.dto';
import { OlhoDeDeusMcpService } from './olho-de-deus-mcp.service';
import { OlhoDeDeusService } from './olho-de-deus.service';
import { NetworkTopologyMappingService } from './network-topology-mapping.service';

@Roles('ADMIN', 'SUPERVISOR')
@Controller('integrations/olho-de-deus')
export class OlhoDeDeusController {
  constructor(
    private readonly olhoDeDeus: OlhoDeDeusService,
    private readonly mcp: OlhoDeDeusMcpService,
    private readonly configuration: OlhoDeDeusConfigurationService,
    private readonly topologyMappings: NetworkTopologyMappingService,
  ) {}

  /** Configuração e teste são exclusivos do ADMIN; SUPERVISOR não vê a chave. */
  @Roles('ADMIN')
  @Get()
  configurationStatus() {
    return this.configuration.getConfiguration();
  }

  @Roles('ADMIN')
  @Put()
  configure(@Body() dto: ConfigureOlhoDeDeusDto) {
    return this.configuration.configure(dto);
  }

  @Roles('ADMIN')
  @Post('test')
  @HttpCode(HttpStatus.OK)
  test() {
    return this.configuration.test();
  }

  @Get('readiness')
  readiness() {
    return this.configuration.readiness();
  }

  /** Painel técnico: somente contagens agregadas, sem OLT/PON nem cliente. */
  @Get('summary')
  summary() {
    return this.configuration.aggregateSummary();
  }

  /** Estado do mapa: visível sem endereços, identificadores ou topologia. */
  @Get('topology-mapping/readiness')
  topologyMappingReadiness() {
    return this.topologyMappings.readiness();
  }

  @Roles('ADMIN')
  @Get('topology-mapping')
  topologyMappingsList() {
    return this.topologyMappings.list();
  }

  /** Entrada sempre começa em sombra; a confirmação é uma ação auditada. */
  @Roles('ADMIN')
  @Post('topology-mapping')
  createTopologyMapping(@Body() dto: CreateNetworkTopologyMappingDto) {
    return this.topologyMappings.createShadow(dto);
  }

  /** Registra evidência de calibração; não promove nem produz ação operacional. */
  @Roles('ADMIN')
  @Post('topology-mapping/calibration')
  recordTopologyCalibration(@Body() dto: RecordNetworkTopologyCalibrationDto) {
    return this.topologyMappings.recordCalibration(dto);
  }

  @Roles('ADMIN')
  @Post('topology-mapping/:id/confirm')
  confirmTopologyMapping(@Param('id') id: string, @Body() dto: ConfirmNetworkTopologyMappingDto) {
    return this.topologyMappings.confirm(id, dto);
  }

  @Roles('ADMIN')
  @Post('topology-mapping/:id/retire')
  retireTopologyMapping(@Param('id') id: string) {
    return this.topologyMappings.retire(id);
  }

  @Get('capabilities')
  capabilities() {
    return this.olhoDeDeus.capabilities();
  }

  @Post('events/simulate')
  normalizeForSimulation(@Body() dto: NormalizeNetworkEventDto) {
    return this.olhoDeDeus.normalizeForSimulation(dto);
  }

  @Get('mcp/tools')
  mcpTools() {
    return this.mcp.tools();
  }

  @Post('mcp/simulate')
  simulateMcp(@Body() dto: SimulateNetworkContextDto) {
    return this.mcp.simulate(dto);
  }
}
