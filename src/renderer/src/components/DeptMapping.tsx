import React from 'react'

const VAT_RATES = ['22.00', '10.00', '5.00', '4.00', '0.00']

interface Props {
  value: Record<string, number>
  onChange: (v: Record<string, number>) => void
}

export function DeptMapping({ value, onChange }: Props) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">Mapping reparti IVA</label>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="pb-1 font-normal">Aliquota IVA</th>
            <th className="pb-1 font-normal">Reparto</th>
          </tr>
        </thead>
        <tbody>
          {VAT_RATES.map((rate) => (
            <tr key={rate}>
              <td className="py-0.5 pr-4">{rate}%</td>
              <td>
                <input
                  type="number"
                  className="w-16 border border-gray-300 rounded px-1 py-0.5 text-sm"
                  value={value[rate] ?? ''}
                  min={1}
                  onChange={(e) => onChange({ ...value, [rate]: Number(e.target.value) })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
