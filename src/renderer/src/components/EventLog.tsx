import React, { useRef, useEffect } from 'react'

interface Props {
  events: string[]
  onClear: () => void
}

export function EventLog({ events, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="text-sm font-medium text-gray-700">Log eventi</label>
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={onClear}>
          Pulisci log
        </button>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded h-28 overflow-y-auto p-2 font-mono text-xs text-gray-600">
        {events.length === 0 ? (
          <span className="text-gray-400">Nessun evento</span>
        ) : (
          events.map((e, i) => <div key={i}>{e}</div>)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
