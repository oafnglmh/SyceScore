import { useEffect, useState } from 'react'

// Router theo hash (#/do-diem): chạy được khi deploy bản build tĩnh mà không cần cấu hình máy chủ.
const current = () => window.location.hash.replace(/^#/, '') || '/'

export default function useHashRoute() {
  const [path, setPath] = useState(current)
  useEffect(() => {
    const onChange = () => {
      setPath(current())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return path
}
