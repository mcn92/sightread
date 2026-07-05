// Language configuration for Python (pack spec §4), hardcoded for M0.
// At M1 this ships inside the pack as pack.yaml → concepts.json config.

export interface BindingRule {
  node: string;
  /** field whose identifier descendants become bound names; '*' = all identifier descendants of the node */
  nameField: string;
}

export interface LangConfig {
  lang: string;
  /** Node types that bound upward promotion (spec §6.2 step 2). */
  promotionStops: Set<string>;
  bindingNodes: BindingRule[];
  scopeNodes: Set<string>;
  commentNodes: Set<string>;
}

export const PY_CONFIG: LangConfig = {
  lang: 'py',
  promotionStops: new Set([
    'expression_statement',
    'return_statement',
    'if_statement',
    'elif_clause',
    'for_statement',
    'while_statement',
    'with_statement',
    'try_statement',
    'function_definition',
    'class_definition',
    'decorated_definition',
    'import_statement',
    'import_from_statement',
    'assert_statement',
    'raise_statement',
    'pass_statement',
    'delete_statement',
    'global_statement',
  ]),
  bindingNodes: [
    { node: 'assignment', nameField: 'left' },
    { node: 'augmented_assignment', nameField: 'left' },
    { node: 'named_expression', nameField: 'name' },
    { node: 'parameters', nameField: '*' },
    { node: 'lambda_parameters', nameField: '*' },
    { node: 'for_statement', nameField: 'left' },
    { node: 'import_statement', nameField: '*' },
    { node: 'import_from_statement', nameField: '*' },
    { node: 'with_item', nameField: '*' },
    { node: 'except_clause', nameField: '*' },
    { node: 'function_definition', nameField: 'name' },
    { node: 'class_definition', nameField: 'name' },
  ],
  scopeNodes: new Set(['module', 'function_definition', 'lambda', 'class_definition']),
  commentNodes: new Set(['comment']),
};
