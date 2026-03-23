import type { Transaction, Rule, RuleCondition, RuleAction } from '@/lib/types/database'

export interface RuleMatch {
  matched: boolean
  rule:    Rule | null
  action:  RuleAction | null
}

// Kör reglermotorn mot en transaktion
// Regler är sorterade på priority (lägst nummer = högst prioritet)
export function evaluateRules(
  transaction: Transaction,
  rules: Rule[]
): RuleMatch {
  // Sortera på prioritet
  const sorted = [...rules].sort((a, b) => a.priority - b.priority)

  for (const rule of sorted) {
    if (!rule.is_active) continue
    if (!rule.conditions || rule.conditions.length === 0) continue

    // Alla conditions måste matcha (AND-logik)
    const allMatch = rule.conditions.every(cond =>
      evaluateCondition(transaction, cond)
    )

    if (allMatch) {
      return { matched: true, rule, action: rule.action }
    }
  }

  return { matched: false, rule: null, action: null }
}

// Evaluera ett enskilt villkor
function evaluateCondition(
  tx: Transaction,
  condition: RuleCondition
): boolean {
  const raw = getFieldValue(tx, condition.field)
  const val = String(raw ?? '').toLowerCase().trim()
  const cmp = condition.value.toLowerCase().trim()

  switch (condition.operator) {
    case 'equals':      return val === cmp
    case 'contains':    return val.includes(cmp)
    case 'starts_with': return val.startsWith(cmp)
    case 'ends_with':   return val.endsWith(cmp)
    case 'greater_than': return parseFloat(val) > parseFloat(cmp)
    case 'less_than':   return parseFloat(val) < parseFloat(cmp)
    case 'between': {
      const n = parseFloat(val)
      const lo = parseFloat(cmp)
      const hi = parseFloat(condition.value2 ?? '0')
      return n >= lo && n <= hi
    }
    case 'in': {
      const list = cmp.split(',').map(s => s.trim())
      return list.includes(val)
    }
    case 'not_in': {
      const list = cmp.split(',').map(s => s.trim())
      return !list.includes(val)
    }
    default: return false
  }
}

// Hämta fältvärde från transaktion
function getFieldValue(
  tx: Transaction,
  field: RuleCondition['field']
): string | number | null {
  switch (field) {
    case 'counterpart_name':    return tx.counterpart_name
    case 'counterpart_org':     return tx.counterpart_org
    case 'transaction_type':    return tx.transaction_type
    case 'amount':              return tx.amount
    case 'description':         return tx.description
    case 'customer_country':    return tx.customer_country
    case 'tax_treatment':       return tx.tax_treatment
    case 'source':              return tx.source
    default: return null
  }
}

// Generera konteringsrader från en matchad regel
export function generateJournalLines(
  transaction: Transaction,
  rule: Rule
) {
  return rule.journal_lines.map(template => ({
    side:        template.side,
    account:     template.account,
    amount:      Math.round(Math.abs(transaction.amount) * template.percent) / 100,
    description: template.description ?? transaction.description ?? rule.name,
  }))
}
