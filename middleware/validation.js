// Password strength requirements
const PASSWORD_RULES = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecial: true,
};

/**
 * Check password strength and return score + details.
 * @param {string} password
 * @returns {{ score: number, level: string, errors: string[] }}
 */
export function checkPasswordStrength(password) {
  const errors = [];
  if (!password || typeof password !== "string") {
    return { score: 0, level: "invalid", errors: ["Password is required"] };
  }
  if (password.length < PASSWORD_RULES.minLength) {
    errors.push(`At least ${PASSWORD_RULES.minLength} characters`);
  }
  if (password.length > PASSWORD_RULES.maxLength) {
    errors.push(`At most ${PASSWORD_RULES.maxLength} characters`);
  }
  if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("At least one uppercase letter");
  }
  if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("At least one lowercase letter");
  }
  if (PASSWORD_RULES.requireDigit && !/\d/.test(password)) {
    errors.push("At least one digit");
  }
  if (PASSWORD_RULES.requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
    errors.push("At least one special character");
  }

  // Score: 0-4 based on how many criteria are met
  let score = 0;
  if (password.length >= PASSWORD_RULES.minLength) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) score++;

  const levels = ["very-weak", "weak", "fair", "good", "strong", "strong"];
  return { score, level: levels[score] || "very-weak", errors };
}

/**
 * Middleware to enforce password strength on newPassword field.
 */
export function validatePasswordStrength(req, res, next) {
  const password = req.body.newPassword || req.body.password;
  if (!password) return next(); // Let other validators handle missing password

  const { errors } = checkPasswordStrength(password);
  if (errors.length > 0) {
    return res.status(400).json({
      error: "Password does not meet strength requirements",
      requirements: errors,
    });
  }
  next();
}

// Input validation middleware
export function validateSearchQuery(req, res, next) {
  const query = req.query.q;
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Thiếu tham số q" });
  }
  // Sanitize query - remove potential XSS
  const sanitized = query.replace(/[<>]/g, "").trim();
  if (sanitized.length === 0) {
    return res.status(400).json({ error: "Tham số q không hợp lệ" });
  }
  if (sanitized.length > 500) {
    return res.status(400).json({ error: "Tham số q quá dài (tối đa 500 ký tự)" });
  }
  req.query.q = sanitized;
  next();
}

export function validatePassword(req, res, next) {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "Thiếu mật khẩu cũ hoặc mới" });
  }
  if (typeof oldPassword !== "string" || typeof newPassword !== "string") {
    return res.status(400).json({ error: "Mật khẩu phải là chuỗi" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Mật khẩu mới phải >= 8 ký tự" });
  }
  if (newPassword.length > 128) {
    return res.status(400).json({ error: "Mật khẩu mới quá dài (tối đa 128 ký tự)" });
  }
  next();
}

export function validateUserInput(req, res, next) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Thiếu username hoặc password" });
  }
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username và password phải là chuỗi" });
  }
  if (username.length < 3 || username.length > 50) {
    return res.status(400).json({ error: "Username phải từ 3-50 ký tự" });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: "Password phải từ 8-128 ký tự" });
  }
  // Sanitize username
  req.body.username = username.replace(/[<>]/g, "").trim();
  next();
}
