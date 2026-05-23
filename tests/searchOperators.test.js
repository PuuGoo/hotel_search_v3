import { describe, test, expect } from "@jest/globals";
import {
  tokenize,
  parse,
  evaluate,
  matchesQuery,
  toPlainQuery,
  extractTerms,
  extractExcluded,
} from "../utils/searchOperators.js";

describe("Search Operators", () => {
  describe("tokenize", () => {
    test("empty query returns empty tokens", () => {
      expect(tokenize("")).toEqual([]);
      expect(tokenize(null)).toEqual([]);
      expect(tokenize(undefined)).toEqual([]);
    });

    test("single term", () => {
      const tokens = tokenize("hotel");
      expect(tokens).toEqual([{ type: "term", value: "hotel" }]);
    });

    test("multiple terms with implicit AND", () => {
      const tokens = tokenize("hotel pool");
      expect(tokens).toEqual([
        { type: "term", value: "hotel" },
        { type: "term", value: "pool" },
      ]);
    });

    test("explicit AND operator", () => {
      const tokens = tokenize("hotel AND pool");
      expect(tokens).toEqual([
        { type: "term", value: "hotel" },
        { type: "AND" },
        { type: "term", value: "pool" },
      ]);
    });

    test("& as AND", () => {
      const tokens = tokenize("hotel & pool");
      expect(tokens).toEqual([
        { type: "term", value: "hotel" },
        { type: "AND" },
        { type: "term", value: "pool" },
      ]);
    });

    test("explicit OR operator", () => {
      const tokens = tokenize("hotel OR resort");
      expect(tokens).toEqual([
        { type: "term", value: "hotel" },
        { type: "OR" },
        { type: "term", value: "resort" },
      ]);
    });

    test("| as OR", () => {
      const tokens = tokenize("hotel | resort");
      expect(tokens).toEqual([
        { type: "term", value: "hotel" },
        { type: "OR" },
        { type: "term", value: "resort" },
      ]);
    });

    test("NOT operator with -", () => {
      const tokens = tokenize("-hostel");
      expect(tokens).toEqual([{ type: "NOT" }, { type: "term", value: "hostel" }]);
    });

    test("NOT keyword", () => {
      const tokens = tokenize("NOT hostel");
      expect(tokens).toEqual([{ type: "NOT" }, { type: "term", value: "hostel" }]);
    });

    test("exact phrase in quotes", () => {
      const tokens = tokenize('"luxury hotel"');
      expect(tokens).toEqual([{ type: "phrase", value: "luxury hotel" }]);
    });

    test("phrase mixed with terms", () => {
      const tokens = tokenize('"luxury hotel" AND pool');
      expect(tokens).toEqual([
        { type: "phrase", value: "luxury hotel" },
        { type: "AND" },
        { type: "term", value: "pool" },
      ]);
    });

    test("parentheses", () => {
      const tokens = tokenize("(hotel OR resort) AND pool");
      expect(tokens).toEqual([
        { type: "LPAREN" },
        { type: "term", value: "hotel" },
        { type: "OR" },
        { type: "term", value: "resort" },
        { type: "RPAREN" },
        { type: "AND" },
        { type: "term", value: "pool" },
      ]);
    });

    test("case insensitive operators", () => {
      const tokens = tokenize("hotel and pool");
      expect(tokens).toEqual([
        { type: "term", value: "hotel" },
        { type: "AND" },
        { type: "term", value: "pool" },
      ]);
    });

    test("unclosed quote treats rest as term", () => {
      const tokens = tokenize('"luxury hotel');
      expect(tokens).toEqual([{ type: "term", value: "luxury hotel" }]);
    });
  });

  describe("parse", () => {
    test("empty tokens returns null", () => {
      expect(parse([])).toBeNull();
      expect(parse(null)).toBeNull();
    });

    test("single term", () => {
      const ast = parse(tokenize("hotel"));
      expect(ast).toEqual({ type: "TERM", value: "hotel" });
    });

    test("AND expression", () => {
      const ast = parse(tokenize("hotel AND pool"));
      expect(ast.type).toBe("AND");
      expect(ast.left).toEqual({ type: "TERM", value: "hotel" });
      expect(ast.right).toEqual({ type: "TERM", value: "pool" });
    });

    test("OR expression", () => {
      const ast = parse(tokenize("hotel OR resort"));
      expect(ast.type).toBe("OR");
      expect(ast.left).toEqual({ type: "TERM", value: "hotel" });
      expect(ast.right).toEqual({ type: "TERM", value: "resort" });
    });

    test("NOT expression", () => {
      const ast = parse(tokenize("-hostel"));
      expect(ast.type).toBe("NOT");
      expect(ast.operand).toEqual({ type: "TERM", value: "hostel" });
    });

    test("phrase", () => {
      const ast = parse(tokenize('"luxury hotel"'));
      expect(ast).toEqual({ type: "PHRASE", value: "luxury hotel" });
    });

    test("implicit AND between terms", () => {
      const ast = parse(tokenize("hotel pool"));
      expect(ast.type).toBe("AND");
    });

    test("grouped expression", () => {
      const ast = parse(tokenize("(hotel OR resort) AND pool"));
      expect(ast.type).toBe("AND");
      expect(ast.left.type).toBe("OR");
      expect(ast.right).toEqual({ type: "TERM", value: "pool" });
    });

    test("complex expression", () => {
      const ast = parse(tokenize('"luxury hotel" AND (pool OR spa) -hostel'));
      expect(ast.type).toBe("AND");
    });
  });

  describe("evaluate", () => {
    test("TERM matches substring", () => {
      const ast = { type: "TERM", value: "hotel" };
      expect(evaluate(ast, "Grand Hotel")).toBe(true);
      expect(evaluate(ast, "motel")).toBe(false);
    });

    test("TERM is case insensitive", () => {
      const ast = { type: "TERM", value: "hotel" };
      expect(evaluate(ast, "HOTEL")).toBe(true);
    });

    test("PHRASE matches exact sequence", () => {
      const ast = { type: "PHRASE", value: "luxury hotel" };
      expect(evaluate(ast, "A luxury hotel in Paris")).toBe(true);
      expect(evaluate(ast, "hotel luxury")).toBe(false);
    });

    test("AND requires both sides", () => {
      const ast = {
        type: "AND",
        left: { type: "TERM", value: "hotel" },
        right: { type: "TERM", value: "pool" },
      };
      expect(evaluate(ast, "Hotel with pool")).toBe(true);
      expect(evaluate(ast, "Hotel only")).toBe(false);
      expect(evaluate(ast, "Pool only")).toBe(false);
    });

    test("OR requires either side", () => {
      const ast = {
        type: "OR",
        left: { type: "TERM", value: "hotel" },
        right: { type: "TERM", value: "resort" },
      };
      expect(evaluate(ast, "Grand Hotel")).toBe(true);
      expect(evaluate(ast, "Beach Resort")).toBe(true);
      expect(evaluate(ast, "Hostel")).toBe(false);
    });

    test("NOT excludes matches", () => {
      const ast = {
        type: "NOT",
        operand: { type: "TERM", value: "hostel" },
      };
      expect(evaluate(ast, "Grand Hotel")).toBe(true);
      expect(evaluate(ast, "Youth Hostel")).toBe(false);
    });

    test("null/empty returns false", () => {
      expect(evaluate(null, "text")).toBe(false);
      expect(evaluate({ type: "TERM", value: "x" }, "")).toBe(false);
      expect(evaluate({ type: "TERM", value: "x" }, null)).toBe(false);
    });
  });

  describe("matchesQuery", () => {
    test("simple term match", () => {
      expect(matchesQuery("hotel", "Grand Hotel")).toBe(true);
      expect(matchesQuery("hotel", "motel")).toBe(false);
    });

    test("AND query", () => {
      expect(matchesQuery("hotel AND pool", "Hotel with pool")).toBe(true);
      expect(matchesQuery("hotel AND pool", "Hotel without amenities")).toBe(false);
    });

    test("OR query", () => {
      expect(matchesQuery("hotel OR resort", "Beach Resort")).toBe(true);
      expect(matchesQuery("hotel OR resort", "Hostel")).toBe(false);
    });

    test("NOT query", () => {
      expect(matchesQuery("hotel -hostel", "Grand Hotel")).toBe(true);
      expect(matchesQuery("hotel -hostel", "Hotel and Hostel")).toBe(false);
    });

    test("phrase query", () => {
      expect(matchesQuery('"luxury hotel"', "A luxury hotel")).toBe(true);
      expect(matchesQuery('"luxury hotel"', "hotel luxury")).toBe(false);
    });

    test("complex query", () => {
      expect(matchesQuery('"luxury hotel" AND pool -hostel', "A luxury hotel with pool")).toBe(true);
      expect(matchesQuery('"luxury hotel" AND pool -hostel', "A luxury hotel hostel with pool")).toBe(false);
    });

    test("empty query returns false", () => {
      expect(matchesQuery("", "text")).toBe(false);
      expect(matchesQuery(null, "text")).toBe(false);
    });
  });

  describe("toPlainQuery", () => {
    test("term returns value", () => {
      expect(toPlainQuery({ type: "TERM", value: "hotel" })).toBe("hotel");
    });

    test("phrase returns quoted value", () => {
      expect(toPlainQuery({ type: "PHRASE", value: "luxury hotel" })).toBe('"luxury hotel"');
    });

    test("AND joins terms", () => {
      const ast = {
        type: "AND",
        left: { type: "TERM", value: "hotel" },
        right: { type: "TERM", value: "pool" },
      };
      expect(toPlainQuery(ast)).toBe("hotel pool");
    });

    test("NOT returns -term", () => {
      const ast = { type: "NOT", operand: { type: "TERM", value: "hostel" } };
      expect(toPlainQuery(ast)).toBe("-hostel");
    });

    test("null returns empty", () => {
      expect(toPlainQuery(null)).toBe("");
    });
  });

  describe("extractTerms", () => {
    test("extracts positive terms", () => {
      const ast = parse(tokenize('"luxury hotel" AND pool -hostel'));
      const terms = extractTerms(ast);
      expect(terms).toContain("luxury hotel");
      expect(terms).toContain("pool");
      expect(terms).not.toContain("hostel");
    });

    test("empty for null", () => {
      expect(extractTerms(null)).toEqual([]);
    });
  });

  describe("extractExcluded", () => {
    test("extracts excluded terms", () => {
      const ast = parse(tokenize("hotel -hostel -motel"));
      const excluded = extractExcluded(ast);
      expect(excluded).toContain("hostel");
      expect(excluded).toContain("motel");
    });

    test("empty for no exclusions", () => {
      const ast = parse(tokenize("hotel pool"));
      expect(extractExcluded(ast)).toEqual([]);
    });
  });
});
