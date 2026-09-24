import { Module } from '@nestjs/common';
import { ResolutionReasonsController } from './resolution-reasons.controller';
import { ResolutionReasonsService } from './resolution-reasons.service';

@Module({ controllers: [ResolutionReasonsController], providers: [ResolutionReasonsService] })
export class ResolutionReasonsModule {}
