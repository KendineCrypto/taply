/** Network-neutral envelope visuals, shared by both builds. */
export const GIFT_DESIGNS = [
  { id: 0, key: 'forest' }, { id: 1, key: 'lime' },
  { id: 2, key: 'linen' }, { id: 3, key: 'midnight' },
] as const;
export type GiftDesignKey = (typeof GIFT_DESIGNS)[number]['key'];
export function designKey(id: number): GiftDesignKey {
  return GIFT_DESIGNS.find(d => d.id === id)?.key ?? 'forest';
}
