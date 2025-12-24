/**
 * Variable Picker Component
 * Allows selecting and inserting variables into input fields
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import { Variable, ChevronDown, Search } from 'lucide-react'
import { Button } from './button'
import { Input } from './input'
import { ScrollArea } from './scroll-area'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflowStore'

interface VariablePickerProps {
  onSelect: (variable: string) => void
  className?: string
}

interface VariableInfo {
  name: string
  source: string
  type: string
}

/**
 * Extract variables defined in Variable nodes
 */
const useWorkflowVariables = (): VariableInfo[] => {
  const nodes = useWorkflowStore((state) => state.nodes)

  return useMemo(() => {
    const variables: VariableInfo[] = []

    // System variables
    variables.push(
      { name: 'timestamp', source: 'System', type: 'number' },
      { name: 'date', source: 'System', type: 'string' },
      { name: 'time', source: 'System', type: 'string' },
      { name: 'datetime', source: 'System', type: 'string' }
    )

    // Variables from Variable nodes
    nodes.forEach((node) => {
      const data = node.data as Record<string, unknown> | undefined
      if (node.type === 'variable' && data?.variableName) {
        variables.push({
          name: String(data.variableName),
          source: 'Variable Node',
          type: typeof data.value === 'object' ? 'object' : typeof data.value,
        })
      }

      // Variables from Data nodes (outputVariable)
      if (data?.outputVariable) {
        let type = 'object'
        if (node.type === 'getQuote') type = 'quote'
        if (node.type === 'getDepth') type = 'depth'
        if (node.type === 'openPosition') type = 'position'
        if (node.type === 'history') type = 'array'

        variables.push({
          name: String(data.outputVariable),
          source: node.type || 'Data Node',
          type,
        })
      }
    })

    return variables
  }, [nodes])
}

/**
 * Common variable paths for different data types
 */
const COMMON_PATHS: Record<string, string[]> = {
  quote: ['ltp', 'open', 'high', 'low', 'close', 'volume', 'prev_close'],
  depth: ['buy[0].price', 'buy[0].quantity', 'sell[0].price', 'sell[0].quantity'],
  position: ['quantity', 'average_price', 'pnl', 'ltp'],
  order: ['order_id', 'status', 'filled_quantity', 'average_price'],
}

export function VariablePicker({ onSelect, className }: VariablePickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const variables = useWorkflowVariables()
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const filteredVariables = useMemo(() => {
    if (!search) return variables
    const lower = search.toLowerCase()
    return variables.filter(
      (v) =>
        v.name.toLowerCase().includes(lower) ||
        v.source.toLowerCase().includes(lower)
    )
  }, [variables, search])

  const handleSelect = (variable: string) => {
    onSelect(`{{${variable}}}`)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => setOpen(!open)}
        className={cn('h-7 gap-1 px-2', className)}
      >
        <Variable className="h-3 w-3" />
        <ChevronDown className="h-3 w-3" />
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover p-2 shadow-md">
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search variables..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-sm"
              />
            </div>

            <ScrollArea className="h-48">
              <div className="space-y-1">
                {filteredVariables.length === 0 ? (
                  <div className="p-2 text-center text-xs text-muted-foreground">
                    No variables found
                  </div>
                ) : (
                  filteredVariables.map((variable) => (
                    <div key={variable.name} className="space-y-0.5">
                      <button
                        type="button"
                        onClick={() => handleSelect(variable.name)}
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <div className="flex items-center gap-2">
                          <Variable className="h-3.5 w-3.5 text-primary" />
                          <span className="font-mono text-xs">{variable.name}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {variable.source}
                        </span>
                      </button>

                      {/* Show common paths for object types */}
                      {COMMON_PATHS[variable.type] && (
                        <div className="ml-5 space-y-0.5">
                          {COMMON_PATHS[variable.type].slice(0, 4).map((path) => (
                            <button
                              key={path}
                              type="button"
                              onClick={() => handleSelect(`${variable.name}.${path}`)}
                              className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <span className="font-mono">.{path}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            <div className="border-t pt-2">
              <div className="text-[10px] text-muted-foreground">
                Use <code className="rounded bg-muted px-1">{'{{varName}}'}</code> in any text field
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Input with variable picker button
 */
interface VariableInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function VariableInput({
  value,
  onChange,
  placeholder,
  className,
}: VariableInputProps) {
  const handleVariableSelect = (variable: string) => {
    onChange(value + variable)
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-8"
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        <VariablePicker onSelect={handleVariableSelect} />
      </div>
    </div>
  )
}
