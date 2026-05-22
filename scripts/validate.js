// Simple HTML validation script
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.join(__dirname, "..", "public");

function validateHtml(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const issues = [];

  // Check for common issues
  if (content.includes("onclick=") && content.includes("JSON.stringify")) {
    issues.push("Found JSON.stringify in onclick attribute - potential XSS risk");
  }

  // Check for inline scripts with user data (more precise check)
  const scriptMatches = content.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scriptMatches) {
    // Check for innerHTML with template literals that include user data
    if (script.includes(".innerHTML") && script.includes("${") && !script.includes("escapeHtml")) {
      issues.push("Found template literals with innerHTML - potential XSS risk (consider using escapeHtml)");
    }
  }

  // Check for missing meta viewport
  if (!content.includes('name="viewport"')) {
    issues.push("Missing viewport meta tag");
  }

  // Check for missing charset
  if (!content.includes('charset="UTF-8"') && !content.includes("charset=utf-8")) {
    issues.push("Missing charset meta tag");
  }

  return issues;
}

// Validate all HTML files
const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith(".html"));

console.log("HTML Validation Report");
console.log("=====================\n");

let totalIssues = 0;

for (const file of htmlFiles) {
  const filePath = path.join(publicDir, file);
  const issues = validateHtml(filePath);

  if (issues.length > 0) {
    console.log(`${file}:`);
    issues.forEach(issue => console.log(`  ⚠️  ${issue}`));
    totalIssues += issues.length;
  } else {
    console.log(`${file}: ✓ OK`);
  }
  console.log("");
}

if (totalIssues === 0) {
  console.log("✅ All HTML files passed validation!");
} else {
  console.log(`⚠️  Found ${totalIssues} issue(s) across ${htmlFiles.length} files`);
}
