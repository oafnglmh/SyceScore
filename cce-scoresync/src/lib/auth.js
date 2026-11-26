// Đăng nhập đơn giản phía trình duyệt: chỉ để chặn người lạ mở giao diện và gọi AI.
// Không phải bảo mật thật (ai đọc mã nguồn đều thấy) – mật khẩu trùng tên đăng nhập theo yêu cầu.
const ACCOUNTS = {
  'thanh.cce': 'thanh.cce',
  'thuy.cce': 'thuy.cce',
}

const STORAGE_KEY = 'cce-auth-user'

/** Trả về tên đăng nhập nếu đúng, ngược lại null. */
export function checkLogin(username, password) {
  const u = String(username || '').trim().toLowerCase()
  return Object.hasOwn(ACCOUNTS, u) && ACCOUNTS[u] === password ? u : null
}

export function getSavedUser() {
  try {
    const u = localStorage.getItem(STORAGE_KEY)
    return u && Object.hasOwn(ACCOUNTS, u) ? u : null
  } catch {
    return null
  }
}

export function saveUser(u) {
  try {
    localStorage.setItem(STORAGE_KEY, u)
  } catch {
    /* trình duyệt chặn lưu trữ → chỉ đăng nhập trong phiên này */
  }
}

export function clearUser() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* bỏ qua */
  }
}
