import { Select } from '@mantine/core';

/** Mantine's searchable select, dressed as the kit's field (flat, bottom rule, Akrobat). */
const KIT_SELECT = {
  input: {
    background: 'rgba(255,255,255,0.07)',
    border: 0,
    borderBottom: '0.25vh solid rgba(255,255,255,0.22)',
    borderRadius: 0,
    color: '#fff',
    fontFamily: 'Akrobat Bold',
    fontSize: '1.45vh',
    height: '3.6vh',
    minHeight: '3.6vh',
  },
} as const;

export function KitSelect({
  value, onChange, data, placeholder, width, clearable = true, mono, invalid,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  data: { value: string; label: string }[];
  placeholder?: string;
  width?: string;
  clearable?: boolean;
  mono?: boolean;
  invalid?: boolean;
}) {
  return (
    <Select
      value={value}
      onChange={onChange}
      data={data}
      placeholder={placeholder}
      clearable={clearable}
      searchable
      styles={{ input: { ...KIT_SELECT.input, ...(mono ? { fontFamily: 'monospace', fontSize: '1.35vh' } : null), ...(invalid ? { borderBottomColor: '#e5484d' } : null) } }}
      style={{ width, flexShrink: 0, minWidth: 0 }}
      comboboxProps={{ zIndex: 10800 }}
    />
  );
}
