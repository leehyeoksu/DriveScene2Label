/** Display metadata per nuScenes camera channel. Layout follows the channel name, never the API array order. */
export interface CameraMeta {
  channel: string;
  ko: string;
  area: 'fl' | 'f' | 'fr' | 'bl' | 'b' | 'br';
  /** Approximate heading for the small FOV glyph only (degrees, left positive). Not used for projection. */
  glyphYaw: number;
}

export const CAMERA_META: Record<string, CameraMeta> = {
  CAM_FRONT_LEFT: { channel: 'CAM_FRONT_LEFT', ko: '앞왼쪽', area: 'fl', glyphYaw: 55 },
  CAM_FRONT: { channel: 'CAM_FRONT', ko: '전방', area: 'f', glyphYaw: 0 },
  CAM_FRONT_RIGHT: { channel: 'CAM_FRONT_RIGHT', ko: '앞오른쪽', area: 'fr', glyphYaw: -55 },
  CAM_BACK_LEFT: { channel: 'CAM_BACK_LEFT', ko: '뒤왼쪽', area: 'bl', glyphYaw: 110 },
  CAM_BACK: { channel: 'CAM_BACK', ko: '후방', area: 'b', glyphYaw: 180 },
  CAM_BACK_RIGHT: { channel: 'CAM_BACK_RIGHT', ko: '뒤오른쪽', area: 'br', glyphYaw: -110 },
};

export function cameraKo(channel: string): string {
  return CAMERA_META[channel]?.ko ?? channel;
}
