import { Eye, EyeOff, Lock, LogIn, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { checkLogin } from '../lib/auth'

// Màu nền trang – nhãn nổi của ô nhập dùng đúng màu này để "cắt" viền.
const PAGE_BG = 'bg-[#f4f6fb]'

function Field({ id, label, icon: Icon, children }) {
  return (
    <div className="relative">
      <label
        htmlFor={id}
        className={`absolute -top-2.5 left-9 z-10 px-2 text-[13.5px] font-medium leading-5 text-slate-700 ${PAGE_BG}`}
      >
        {label}
      </label>
      <Icon className="pointer-events-none absolute left-5 top-1/2 size-[18px] -translate-y-1/2 text-slate-500" />
      {children}
    </div>
  )
}

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = 'CCE · Đăng nhập'
  }, [])

  const submit = (e) => {
    e.preventDefault()
    const user = checkLogin(username, password)
    if (user) onLogin(user)
    else setError('Sai tên đăng nhập hoặc mật khẩu.')
  }

  const input =
    'h-[52px] w-full rounded-full border border-slate-300 bg-transparent pl-12 pr-5 text-[15px] text-slate-900 transition placeholder:text-slate-400 hover:border-slate-400 focus:border-cce-500 focus:outline-none focus:ring-4 focus:ring-cce-500/15'

  return (
    <div className={`relative min-h-screen overflow-hidden ${PAGE_BG}`}>
      {/* Khối vòm chứa ảnh – chỉ hiện trên màn hình rộng */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 lg:block">
        <div className="absolute -right-[6%] bottom-0 left-[2%] top-[20%] overflow-hidden rounded-t-[360px] bg-cce-100/70">
          <img
            src="/login-hero.jpg"
            alt=""
            className="h-full w-full object-cover object-[45%_top]"
          />
        </div>
      </div>

      <div className="relative grid min-h-screen lg:grid-cols-2">
        <div className="flex items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[420px]">
            {/* Ảnh rút gọn cho điện thoại / máy tính bảng */}
            <img
              src="/login-hero.jpg"
              alt="Hai cán bộ CCE đang dò điểm"
              className="mb-8 h-44 w-full rounded-3xl object-cover sm:h-56 lg:hidden"
            />

            <div className="mb-10 flex flex-col items-center text-center">
              <img src="/cce-emblem.png" alt="CCE" className="h-12 w-auto" />
              <h1 className="mt-5 text-[32px] font-bold leading-tight tracking-tight text-cce-700 sm:text-[38px]">
                Chào mừng trở lại!
              </h1>
              <p className="mt-2 text-[13.5px] text-slate-500">
                Đăng nhập để tiếp tục vào <span className="font-semibold text-cce-700">CCE ScoreSync</span>
              </p>
            </div>

            <form onSubmit={submit} className="space-y-7">
              <Field id="login-user" label="Tên đăng nhập" icon={User}>
                <input
                  id="login-user"
                  className={input}
                  placeholder="vd: thanh.cce"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => (setUsername(e.target.value), setError(''))}
                />
              </Field>

              <Field id="login-pass" label="Mật khẩu" icon={Lock}>
                <input
                  id="login-pass"
                  type={showPass ? 'text' : 'password'}
                  className={`${input} pr-14`}
                  placeholder="Nhập mật khẩu"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => (setPassword(e.target.value), setError(''))}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-slate-500 transition hover:bg-slate-200/60 hover:text-slate-700"
                  aria-label={showPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  {showPass ? <Eye className="size-[18px]" /> : <EyeOff className="size-[18px]" />}
                </button>
              </Field>

              {error && <p className="-mt-3 pl-5 text-[13px] text-rose-600">{error}</p>}

              <button
                type="submit"
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-cce-700 text-[15px] font-semibold text-white shadow-lg shadow-cce-700/30 transition hover:bg-cce-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-cce-500/30 active:scale-[0.99]"
              >
                <LogIn className="size-[18px]" />
                Đăng nhập
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
