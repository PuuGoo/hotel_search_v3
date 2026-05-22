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
