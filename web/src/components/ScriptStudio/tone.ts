/**
 * A steady colour for a name (a script in the logs, a vehicle class): the same
 * name always reads the same, from one palette, with nobody tagging anything.
 */
const PALETTE = ['#339af0', '#15aabf', '#fd7e14', '#be4bdb', '#e64980', '#20c997', '#fab005', '#7950f2', '#4c6ef5', '#94d82d'];

export function toneOf(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
