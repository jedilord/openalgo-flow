/**
 * Variable Store
 * Manages workflow variables during execution
 * Supports JSON parsing, nested property access, and variable interpolation
 */

import { create } from 'zustand'

interface VariableState {
  // Variables stored by workflow ID
  variables: Record<string, Record<string, unknown>>

  // Current workflow context
  currentWorkflowId: string | null

  // Actions
  setCurrentWorkflow: (workflowId: string) => void
  setVariable: (name: string, value: unknown) => void
  getVariable: (name: string) => unknown
  getVariableByPath: (path: string) => unknown
  deleteVariable: (name: string) => void
  clearVariables: () => void
  getAllVariables: () => Record<string, unknown>

  // JSON operations
  parseJson: (jsonString: string) => unknown
  stringifyValue: (value: unknown) => string

  // Math operations
  addToVariable: (name: string, value: number) => void
  subtractFromVariable: (name: string, value: number) => void
  multiplyVariable: (name: string, value: number) => void
  divideVariable: (name: string, value: number) => void
  incrementVariable: (name: string) => void
  decrementVariable: (name: string) => void

  // String operations
  appendToVariable: (name: string, value: string) => void

  // Interpolation
  interpolate: (template: string) => string
}

/**
 * Get nested property from object using dot notation
 * e.g., getNestedValue({ data: { ltp: 100 } }, 'data.ltp') => 100
 */
const getNestedValue = (obj: unknown, path: string): unknown => {
  if (!obj || typeof obj !== 'object') return undefined

  const keys = path.split('.')
  let current: unknown = obj

  for (const key of keys) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

export const useVariableStore = create<VariableState>((set, get) => ({
  variables: {},
  currentWorkflowId: null,

  setCurrentWorkflow: (workflowId) => {
    set({ currentWorkflowId: workflowId })
    // Initialize variables for this workflow if not exists
    const { variables } = get()
    if (!variables[workflowId]) {
      set({ variables: { ...variables, [workflowId]: {} } })
    }
  },

  setVariable: (name, value) => {
    const { currentWorkflowId, variables } = get()
    if (!currentWorkflowId) return

    set({
      variables: {
        ...variables,
        [currentWorkflowId]: {
          ...variables[currentWorkflowId],
          [name]: value,
        },
      },
    })
  },

  getVariable: (name) => {
    const { currentWorkflowId, variables } = get()
    if (!currentWorkflowId) return undefined
    return variables[currentWorkflowId]?.[name]
  },

  getVariableByPath: (path) => {
    const { currentWorkflowId, variables } = get()
    if (!currentWorkflowId) return undefined

    // Check if path contains dots (nested access)
    if (path.includes('.')) {
      const [varName, ...rest] = path.split('.')
      const variable = variables[currentWorkflowId]?.[varName]
      if (rest.length === 0) return variable
      return getNestedValue(variable, rest.join('.'))
    }

    return variables[currentWorkflowId]?.[path]
  },

  deleteVariable: (name) => {
    const { currentWorkflowId, variables } = get()
    if (!currentWorkflowId) return

    const workflowVars = { ...variables[currentWorkflowId] }
    delete workflowVars[name]

    set({
      variables: {
        ...variables,
        [currentWorkflowId]: workflowVars,
      },
    })
  },

  clearVariables: () => {
    const { currentWorkflowId, variables } = get()
    if (!currentWorkflowId) return

    set({
      variables: {
        ...variables,
        [currentWorkflowId]: {},
      },
    })
  },

  getAllVariables: () => {
    const { currentWorkflowId, variables } = get()
    if (!currentWorkflowId) return {}
    return variables[currentWorkflowId] || {}
  },

  parseJson: (jsonString) => {
    try {
      return JSON.parse(jsonString)
    } catch {
      console.error('Failed to parse JSON:', jsonString)
      return null
    }
  },

  stringifyValue: (value) => {
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  },

  addToVariable: (name, value) => {
    const { getVariable, setVariable } = get()
    const current = Number(getVariable(name)) || 0
    setVariable(name, current + value)
  },

  subtractFromVariable: (name, value) => {
    const { getVariable, setVariable } = get()
    const current = Number(getVariable(name)) || 0
    setVariable(name, current - value)
  },

  multiplyVariable: (name, value) => {
    const { getVariable, setVariable } = get()
    const current = Number(getVariable(name)) || 0
    setVariable(name, current * value)
  },

  divideVariable: (name, value) => {
    const { getVariable, setVariable } = get()
    const current = Number(getVariable(name)) || 0
    if (value === 0) {
      console.error('Division by zero')
      return
    }
    setVariable(name, current / value)
  },

  incrementVariable: (name) => {
    const { addToVariable } = get()
    addToVariable(name, 1)
  },

  decrementVariable: (name) => {
    const { subtractFromVariable } = get()
    subtractFromVariable(name, 1)
  },

  appendToVariable: (name, value) => {
    const { getVariable, setVariable } = get()
    const current = String(getVariable(name) || '')
    setVariable(name, current + value)
  },

  /**
   * Interpolate variables in a template string
   * Supports: {{variableName}}, {{variableName.nested.path}}
   * Example: "LTP is {{quote.ltp}}" => "LTP is 18500.50"
   */
  interpolate: (template) => {
    const { getVariableByPath } = get()

    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const trimmedPath = path.trim()
      const value = getVariableByPath(trimmedPath)

      if (value === undefined || value === null) {
        return match // Keep original if variable not found
      }

      if (typeof value === 'object') {
        return JSON.stringify(value)
      }

      return String(value)
    })
  },
}))

/**
 * Utility function to execute variable operations
 * Used by workflow executor
 */
export const executeVariableOperation = (
  operation: string,
  variableName: string,
  value: unknown,
  sourceVariable?: string,
  jsonPath?: string
) => {
  const store = useVariableStore.getState()

  switch (operation) {
    case 'set':
      store.setVariable(variableName, value)
      break

    case 'get':
      // Get from source variable and store in target
      if (sourceVariable) {
        const sourceValue = jsonPath
          ? store.getVariableByPath(`${sourceVariable}.${jsonPath}`)
          : store.getVariable(sourceVariable)
        store.setVariable(variableName, sourceValue)
      }
      break

    case 'add':
      store.addToVariable(variableName, Number(value))
      break

    case 'subtract':
      store.subtractFromVariable(variableName, Number(value))
      break

    case 'multiply':
      store.multiplyVariable(variableName, Number(value))
      break

    case 'divide':
      store.divideVariable(variableName, Number(value))
      break

    case 'increment':
      store.incrementVariable(variableName)
      break

    case 'decrement':
      store.decrementVariable(variableName)
      break

    case 'parse_json':
      const parsed = store.parseJson(String(value))
      store.setVariable(variableName, parsed)
      break

    case 'stringify':
      if (sourceVariable) {
        const toStringify = store.getVariable(sourceVariable)
        store.setVariable(variableName, store.stringifyValue(toStringify))
      } else {
        store.setVariable(variableName, store.stringifyValue(value))
      }
      break

    case 'append':
      store.appendToVariable(variableName, String(value))
      break

    default:
      console.warn(`Unknown variable operation: ${operation}`)
  }
}

/**
 * Predefined system variables that are always available
 */
export const SYSTEM_VARIABLES = {
  timestamp: () => Date.now(),
  date: () => new Date().toISOString().split('T')[0],
  time: () => new Date().toTimeString().split(' ')[0],
  datetime: () => new Date().toISOString(),
} as const
