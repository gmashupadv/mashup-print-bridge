import React from 'react'
import { Listbox } from '@headlessui/react'

const STUBS = ['ditron-wec', 'escpos-network']

interface Props {
  drivers: string[]
  value: string
  onChange: (v: string) => void
  className?: string
}

export function DriverPicker({ drivers, value, onChange, className }: Props) {
  return (
    <div className={className}>
      <Listbox value={value} onChange={onChange}>
        <div className="relative">
          <Listbox.Button className="w-full border border-gray-300 rounded px-3 py-2 text-left bg-white text-sm flex justify-between items-center">
            <span>{value}</span>
            {STUBS.includes(value) && (
              <span className="text-xs text-amber-600 ml-2">⚠ Non implementato</span>
            )}
          </Listbox.Button>
          <Listbox.Options className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg text-sm">
            {drivers.map((d) => (
              <Listbox.Option
                key={d}
                value={d}
                className={({ active }) =>
                  `px-3 py-2 cursor-pointer flex justify-between ${active ? 'bg-blue-50' : ''}`
                }
              >
                <span>{d}</span>
                {STUBS.includes(d) && <span className="text-xs text-amber-500">⚠</span>}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </div>
      </Listbox>
    </div>
  )
}
