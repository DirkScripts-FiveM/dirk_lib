/**
 * `x-bodyHeight`: this position is stored at BODY height, not the ground.
 *
 * dirk_lib's walk-and-set capture stores the ground under the player - the
 * place itself - so something spawned there stands on it rather than hovering
 * a metre up. Scripts written before that stored `GetEntityCoords` as-is,
 * which reads about a metre above the floor, and subtract the metre back
 * themselves when they place a ped. Their saved data and their placement code
 * agree with each other; a ground-height capture landing in that data puts
 * whatever spawns there a metre underground.
 *
 * Declaring the field's convention is the fix that leaves both alone: the
 * capture is lifted back to body height for the fields that ask, and nothing
 * already saved has to be migrated.
 */
export const BODY_OFFSET = 1.0;

export function toBodyHeight<T extends { z?: number }>(value: T, bodyHeight?: boolean): T {
  if (!bodyHeight || !value || typeof value.z !== 'number') return value;
  return { ...value, z: value.z + BODY_OFFSET };
}
