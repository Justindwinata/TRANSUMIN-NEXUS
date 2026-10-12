import { Module } from '@nestjs/common';

import { HealthModule } from './health/health.module.js';
import { OperationalDataModule } from './operational-data/operational-data.module.js';
import { MobilityTwinModule } from './mobility-twin/mobility-twin.module.js';
import { SpatialModule } from './spatial/spatial.module.js';
import { TransitModule } from './transit/transit.module.js';
import { DisruptionModule } from './disruption/disruption.module.js';
import { JourneyModule } from './journey/journey.module.js';

@Module({
  imports: [
    HealthModule,
    TransitModule,
    OperationalDataModule,
    SpatialModule,
    MobilityTwinModule,
    DisruptionModule,
    JourneyModule,
  ],
})
export class AppModule {}
