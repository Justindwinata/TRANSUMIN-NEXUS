import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
} from '@nestjs/common';

import { TransitPlaceSearchService } from '../application/transit-place-search.service.js';

@Controller('transit/places')
export class TransitPlacesController {
  constructor(
    @Inject(TransitPlaceSearchService)
    private readonly places: TransitPlaceSearchService,
  ) {}

  @Get()
  async search(
    @Query('q') rawQuery?: string,
    @Query('snapshot_id') snapshotId?: string,
  ): Promise<Record<string, unknown>> {
    const requestId = randomUUID();
    const query = rawQuery?.trim() ?? '';
    if (query.length < 2 || query.length > 80)
      throw invalid('q must contain 2–80 characters.', requestId);
    if (!snapshotId || !/^[0-9a-f-]{36}$/i.test(snapshotId))
      throw invalid('snapshot_id must be a UUID.', requestId);
    const data = await this.places.search(query, snapshotId);
    return {
      data: data.map((place) => ({
        place_id: place.placeId,
        external_id: place.externalId,
        name: place.name,
        kind: place.kind,
        product_mode: place.productMode,
        latitude: place.latitude,
        longitude: place.longitude,
        dataset_version_id: place.datasetVersionId,
        provenance: place.provenance,
      })),
      meta: { request_id: requestId, warnings: [], next_cursor: null },
    };
  }
}

function invalid(message: string, requestId: string): BadRequestException {
  return new BadRequestException({
    error: { code: 'INVALID_PARAMETER', message, request_id: requestId },
  });
}
