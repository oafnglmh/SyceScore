import { LogIn } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../components/ui'
import { checkLogin } from '../lib/auth'

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
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
    'h-11 w-full rounded-xl border-0 bg-white px-3.5 text-sm text-slate-900 ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cce-500'

  return (
    <div className="cce-arcs flex min-h-screen items-center justify-center bg-cce-700 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          <img src="/cce-emblem-white.png" alt="CCE" className="h-16 w-auto" />
          <div className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gold-300">
            Trung tâm Đào tạo Thường xuyên · Đại học Đà Nẵng
          </div>
          <div className="mt-1 text-lg font-semibold">CCE ScoreSync</div>
        </div>

        <form onSubmit={submit} className="rounded-2xl bg-white p-6 shadow-2xl shadow-cce-950/30">
          <h1 className="mb-5 text-base font-semibold text-slate-900">Đăng nhập</h1>

          <label className="mb-1.5 block text-[13px] font-medium text-slate-600" htmlFor="login-user">
            Tên đăng nhập
          </label>
          <input
            id="login-user"
            className={input}
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => (setUsername(e.target.value), setError(''))}
          />

          <label className="mb-1.5 mt-4 block text-[13px] font-medium text-slate-600" htmlFor="login-pass">
            Mật khẩu
          </label>
          <input
            id="login-pass"
            type="password"
            className={input}
            autoComplete="current-password"
            value={password}
            onChange={(e) => (setPassword(e.target.value), setError(''))}
          />

          {error && <p className="mt-3 text-[13px] text-rose-600">{error}</p>}

          <Button type="submit" variant="primary" size="lg" icon={LogIn} className="mt-5 w-full">
            Đăng nhập
          </Button>
        </form>
      </div>
    </div>
  )
}
