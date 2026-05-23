// Advanced search operators — parse queries with AND, OR, NOT, "exact phrase"
// Supports: AND(&), OR(|), NOT(-), "exact phrase", (grouping)

/**
 * Tokenize a search query into operators and terms.
 * Examples:
 *   'hotel AND pool' → [{ type: 'term', value: 'hotel' }, { type: 'AND' }, { type: 'term', value: 'pool' }]
 *   '"luxury hotel" OR resort' → [{ type: 'phrase', value: 'luxury hotel' }, { type: 'OR' }, { type: 'term', value: 'resort' }]
 *   '-hostel' → [{ type: 'NOT' }, { type: 'term', value: 'hostel' }]
 */
export function tokenize(query) {
  if (!query || typeof query !== "string") return [];

  const tokens = [];
  let i = 0;
  const str = query.trim();

  while (i < str.length) {
    // Skip whitespace
    if (str[i] === " " || str[i] === "\t") {
      i++;
      continue;
    }

    // Exact phrase
    if (str[i] === '"') {
      const end = str.indexOf('"', i + 1);
      if (end !== -1) {
        const phrase = str.slice(i + 1, end).trim();
        if (phrase) tokens.push({ type: "phrase", value: phrase });
        i = end + 1;
        continue;
      }
      // Unclosed quote — treat rest as term
      const term = str.slice(i + 1).trim();
      if (term) tokens.push({ type: "term", value: term });
      break;
    }

    // Parentheses
    if (str[i] === "(") {
      tokens.push({ type: "LPAREN" });
      i++;
      continue;
    }
    if (str[i] === ")") {
      tokens.push({ type: "RPAREN" });
      i++;
      continue;
    }

    // Operators
    if (str[i] === "-" && (i === 0 || str[i - 1] === " " || str[i - 1] === "(")) {
      tokens.push({ type: "NOT" });
      i++;
      continue;
    }
    if (str[i] === "&") {
      tokens.push({ type: "AND" });
      i++;
      continue;
    }
    if (str[i] === "|") {
      tokens.push({ type: "OR" });
      i++;
      continue;
    }

    // Word (may contain AND/OR/NOT keywords)
    let word = "";
    while (i < str.length && str[i] !== " " && str[i] !== "\t" && str[i] !== '"' && str[i] !== "(" && str[i] !== ")" && str[i] !== "&" && str[i] !== "|") {
      // Allow - at start of word for NOT
      if (str[i] === "-" && word === "") break;
      word += str[i];
      i++;
    }

    if (!word) {
      i++;
      continue;
    }

    const upper = word.toUpperCase();
    if (upper === "AND") {
      tokens.push({ type: "AND" });
    } else if (upper === "OR") {
      tokens.push({ type: "OR" });
    } else if (upper === "NOT") {
      tokens.push({ type: "NOT" });
    } else {
      tokens.push({ type: "term", value: word });
    }
  }

  return tokens;
}

/**
 * Parse tokens into an AST (Abstract Syntax Tree).
 * Returns: { type: 'AND'|'OR'|'NOT'|'PHRASE'|'TERM', value, left?, right? }
 */
export function parse(tokens) {
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;

  function peek() {
    return pos < tokens.length ? tokens[pos] : null;
  }

  function consume(expectedType) {
    const token = tokens[pos];
    if (expectedType && token?.type !== expectedType) {
      throw new Error(`Expected ${expectedType}, got ${token?.type}`);
    }
    pos++;
    return token;
  }

  function parseOr() {
    let left = parseAnd();
    while (peek()?.type === "OR") {
      consume("OR");
      const right = parseAnd();
      left = { type: "OR", left, right };
    }
    return left;
  }

  function parseAnd() {
    let left = parseNot();
    while (peek()?.type === "AND") {
      consume("AND");
      const right = parseNot();
      left = { type: "AND", left, right };
    }
    // Implicit AND: two consecutive terms without explicit operator
    while (pos < tokens.length && peek()?.type !== "OR" && peek()?.type !== "RPAREN") {
      const next = peek();
      if (!next || next.type === "AND" || next.type === "OR" || next.type === "RPAREN") break;
      if (next.type === "NOT" || next.type === "term" || next.type === "phrase" || next.type === "LPAREN") {
        const right = parseNot();
        left = { type: "AND", left, right };
      } else {
        break;
      }
    }
    return left;
  }

  function parseNot() {
    if (peek()?.type === "NOT") {
      consume("NOT");
      const operand = parseAtom();
      return { type: "NOT", operand };
    }
    return parseAtom();
  }

  function parseAtom() {
    const token = peek();
    if (!token) return null;

    if (token.type === "LPAREN") {
      consume("LPAREN");
      const expr = parseOr();
      if (peek()?.type === "RPAREN") consume("RPAREN");
      return expr;
    }

    if (token.type === "term") {
      consume();
      return { type: "TERM", value: token.value };
    }

    if (token.type === "phrase") {
      consume();
      return { type: "PHRASE", value: token.value };
    }

    // Skip unknown tokens
    consume();
    return parseAtom();
  }

  return parseOr();
}

/**
 * Evaluate an AST node against a text string.
 * Returns true if the text matches the query.
 */
export function evaluate(ast, text) {
  if (!ast || !text) return false;
  const lower = text.toLowerCase();

  switch (ast.type) {
    case "TERM":
      return lower.includes(ast.value.toLowerCase());
    case "PHRASE":
      return lower.includes(ast.value.toLowerCase());
    case "AND":
      return evaluate(ast.left, text) && evaluate(ast.right, text);
    case "OR":
      return evaluate(ast.left, text) || evaluate(ast.right, text);
    case "NOT":
      return !evaluate(ast.operand, text);
    default:
      return false;
  }
}

/**
 * Parse and evaluate in one step.
 */
export function matchesQuery(query, text) {
  const tokens = tokenize(query);
  const ast = parse(tokens);
  return evaluate(ast, text);
}

/**
 * Convert AST back to a search-engine-friendly query string.
 * Strips operators and returns plain terms for engines that don't support boolean queries.
 */
export function toPlainQuery(ast) {
  if (!ast) return "";
  switch (ast.type) {
    case "TERM":
      return ast.value;
    case "PHRASE":
      return `"${ast.value}"`;
    case "AND":
      return `${toPlainQuery(ast.left)} ${toPlainQuery(ast.right)}`;
    case "OR":
      return `${toPlainQuery(ast.left)} ${toPlainQuery(ast.right)}`;
    case "NOT":
      return `-${toPlainQuery(ast.operand)}`;
    default:
      return "";
  }
}

/**
 * Extract all positive terms (excluding NOT terms) from AST.
 */
export function extractTerms(ast) {
  if (!ast) return [];
  switch (ast.type) {
    case "TERM":
      return [ast.value];
    case "PHRASE":
      return [ast.value];
    case "AND":
    case "OR":
      return [...extractTerms(ast.left), ...extractTerms(ast.right)];
    case "NOT":
      return [];
    default:
      return [];
  }
}

/**
 * Extract excluded terms (NOT terms) from AST.
 */
export function extractExcluded(ast) {
  if (!ast) return [];
  switch (ast.type) {
    case "NOT":
      return extractTerms(ast.operand);
    case "AND":
    case "OR":
      return [...extractExcluded(ast.left), ...extractExcluded(ast.right)];
    default:
      return [];
  }
}
