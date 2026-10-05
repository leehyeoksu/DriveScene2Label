import type {
  CalibratedSensorDto, EgoPoseDto, GtAnnotationDto, JobResultsDto, JobStatusDto, SampleDetailDto, SampleDto, SensorFileDto,
} from '@/api/dto';

/** DTO builders in the real Spring response shapes (README_API.md). Test-only. */
export function sampleDto(i: number, over: Partial<SampleDto> = {}): SampleDto {
  return { id: 100 + i, datasetId: 1, token: `s${i}`, sceneToken: 'scene-tok', timestampUs: 1_532_402_927_647_951 + i * 500_000, prevToken: i ? `s${i - 1}` : null, nextToken: `s${i + 1}`, ...over };
}

export function sensorFileDto(id: number, channel: string, over: Partial<SensorFileDto> = {}): SensorFileDto {
  const camera = channel.startsWith('CAM_');
  return {
    id, token: `sd-${id}`, channel, modality: camera ? 'camera' : 'lidar', relativePath: `samples/${channel}/${id}.jpg`,
    timestampUs: 1_532_402_927_647_951, isKeyFrame: true, width: camera ? 1600 : 0, height: camera ? 900 : 0,
    egoPoseToken: `ep-${id}`, calibratedSensorToken: `cs-${channel}`, vehicleX: 400, vehicleY: 1100, vehicleZ: 0,
    contentUrl: `/api/sensor-files/${id}/content`, ...over,
  };
}

export function sampleDetailDto(sample: SampleDto, channels: string[]): SampleDetailDto {
  return { sample, sensorFiles: channels.map((c, i) => sensorFileDto(sample.id * 10 + i, c)), maps: [{ id: 1, token: 'm', relativePath: 'maps/x.png', location: 'singapore-onenorth', contentUrl: '/api/maps/1/content' }] };
}

export function gtDto(id: number, over: Partial<GtAnnotationDto> = {}): GtAnnotationDto {
  return {
    id, datasetId: 1, token: `ann-${id}`, sampleToken: 's0', instanceToken: `inst-${id}`, visibilityToken: '4',
    centerX: 410, centerY: 1100, centerZ: 1, sizeW: 2, sizeL: 4.5, sizeH: 1.6, rotationW: 1, rotationX: 0, rotationY: 0, rotationZ: 0,
    numLidarPts: 12, numRadarPts: 0, prevToken: null, nextToken: null, categoryToken: 'cat-car', categoryName: 'vehicle.car', ...over,
  };
}

export function calibrationDto(over: Partial<CalibratedSensorDto> = {}): CalibratedSensorDto {
  return {
    id: 1, datasetId: 1, token: 'cs-CAM_FRONT', sensorToken: 'sensor-front', translationX: 1.7, translationY: 0, translationZ: 1.5,
    rotationW: 0.5, rotationX: -0.5, rotationY: 0.5, rotationZ: -0.5,
    intrinsic00: 1266, intrinsic01: 0, intrinsic02: 816, intrinsic10: 0, intrinsic11: 1266, intrinsic12: 491, intrinsic20: 0, intrinsic21: 0, intrinsic22: 1,
    ...over,
  };
}

export function poseDto(over: Partial<EgoPoseDto> = {}): EgoPoseDto {
  return { id: 1, datasetId: 1, token: 'ep', timestampUs: 1_532_402_927_647_951, translationX: 400, translationY: 1100, translationZ: 0, rotationW: 1, rotationX: 0, rotationY: 0, rotationZ: 0, ...over };
}

export function jobStatusDto(over: Partial<JobStatusDto> = {}): JobStatusDto {
  return { jobId: 12, datasetId: 1, status: 'RUNNING', errorMessage: null, createdAt: '2026-10-03T12:00:00Z', startedAt: '2026-10-03T12:00:01Z', completedAt: null, ...over };
}

export function jobResultsDto(over: Partial<JobResultsDto> = {}): JobResultsDto {
  return {
    jobId: 12, datasetId: 1, mappingName: '8class', coordinateFrame: 'WORLD', scoreType: 'VESPA_CONSTANT', sampleTokens: ['s0', 's1'],
    boxes: [{ id: 900, sampleToken: 's0', boxIndex: 0, detectionName: 'car', centerX: 410, centerY: 1100, centerZ: 1, sizeW: 2, sizeL: 4, sizeH: 1.5, rotationW: 1, rotationX: 0, rotationY: 0, rotationZ: 0, velocityX: 1, velocityY: 0, detectionScore: 1, attributeName: '' }],
    artifacts: [{ id: 9, artifactType: 'FINAL_JSON', storageKey: 'vespa-results', relativePath: 'run/x.json', checksum: 'a'.repeat(64), contentType: 'application/json' }],
    ...over,
  };
}
